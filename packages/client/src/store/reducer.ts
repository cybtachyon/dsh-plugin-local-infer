/**
 * The pure reducer for the whole CardAction union: the only mutator of
 * CardState. Every server round trip is a pending -> ack | timeout transition
 * (the action and template cells settle only while they are still pending, so
 * a late ack after the deadline is a no-op), the draft is the only source for
 * form field values (a summary ack merges its persisted fields into the draft
 * field-level, and a discard resets it from the summary), and the per-provider
 * launch machine is the only source for lifecycle state (launch/move delegates
 * to launchNextState and stamps the startTime the deadline timers price).
 * @module dsh-plugin-local-infer/client/store/reducer
 */

import type {
  LocalInferSummary,
  StoredPlatformConfig,
} from 'dsh-plugin-local-infer/ui'
import { launchNextState } from '../machine/launch.ts'
import type {
  ActionKey,
  CardAction,
  CardDraft,
  CardState,
  CardUiState,
} from './types.ts'

/**
 * ACTION_TIMEOUT_DETAIL is the detail a deadline timer stamps when an action
 * (or the template download) is still pending at the cap. The component maps
 * it to the localized "timed out" label; the reducer itself stays locale-
 * agnostic.
 */
export const ACTION_TIMEOUT_DETAIL = 'timeout'

/**
 * cardReducer reduces one CardAction over a CardState and returns the next
 * state. It is pure: no clock read leaks into the summary, draft, note, or ui
 * paths, and the only Date.now() in the file is the launch/move startTime
 * stamp the deadline timers arm off. An action it has not named yet leaves the
 * state untouched, so a late or unknown event never corrupts it.
 */
export function cardReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'summary/ack':
      return summaryAck(state, action.summary)
    case 'summary/fail':
      return { ...state, summaryNote: action.note }
    case 'deps/ack':
      return { ...state, deps: action.deps, notes: { ...state.notes, deps: '' } }
    case 'deps/fail':
      return { ...state, notes: { ...state.notes, deps: action.note } }
    case 'deps/clear':
      return { ...state, deps: null, notes: { ...state.notes, deps: '' } }
    case 'draft/edit':
      return draftEdit(state, action.draft)
    case 'draft/discard':
      return draftDiscard(state)
    case 'action/start':
      return actionEnter(state, action.key)
    case 'action/ack':
      return actionSettle(state, action.key, 'ok', action.detail)
    case 'action/fail':
      return actionSettle(state, action.key, 'error', action.detail)
    case 'action/timeout':
      return actionSettle(state, action.key, 'error', ACTION_TIMEOUT_DETAIL)
    case 'template/start':
      return templateEnter(state)
    case 'template/ack':
      return templateSettle(state, 'ok', action.detail)
    case 'template/fail':
      return templateSettle(state, 'error', action.detail)
    case 'template/timeout':
      return templateSettle(state, 'error', ACTION_TIMEOUT_DETAIL)
    case 'launch/move':
      return launchMove(state, action.providerId, action.event)
    case 'note/set':
      return { ...state, notes: { ...state.notes, [action.key]: action.note } }
    case 'note/clear':
      return { ...state, notes: { ...state.notes, [action.key]: '' } }
    case 'ui/patch':
      return { ...state, ui: { ...state.ui, ...action.patch } }
    default:
      return state
  }
}

// summaryAck stores the summary (the read model), clears the summary note and
// the streamed Get buffer (the Logs pane yields to the persisted last-run logs
// the summary now carries), and merges the summary's persisted fields into the
// draft field-level. The draft always carries a form to draw: the summary's
// engine and config, with the platform entries merged per-engine so the
// persisted platformConfigs surface and the draft's unsaved local platform
// edits survive the re-price refetch a spec field change fires.
function summaryAck(state: CardState, summary: LocalInferSummary): CardState {
  const persisted = summary.platformConfigs ?? {}
  const mergedPlatform: Record<string, StoredPlatformConfig> = { ...persisted }
  if (state.draft !== null && state.draft.platform) {
    for (const engineId of Object.keys(state.draft.platform)) {
      mergedPlatform[engineId] = {
        ...persisted[engineId],
        ...state.draft.platform[engineId],
      }
    }
  }
  const draft: CardDraft = {
    engine: summary.engineId,
    config: summary.config,
    platform: mergedPlatform,
  }
  // The stored preference wins over the default; a summary that predates the
  // key keeps the descriptions visible. The log-location field seeds from the
  // stored template only when it is a non-blank string.
  const ui: CardUiState = {
    ...state.ui,
    help: summary.showHelp !== false,
    logPath:
      typeof summary.logPath === 'string' && summary.logPath !== ''
        ? summary.logPath
        : state.ui.logPath,
    logs: { ...state.ui.logs, getLogs: null },
  }
  return { ...state, summary, summaryNote: '', draft, ui }
}

// draftEdit stores the new draft (the only form-value source), sets dirty, and
// clears the notes a field edit makes stale: the save note (the last Save
// result no longer describes the draft), the deps note, and the lifecycle note.
// The lifecycle note has no home in the store (the launch machine carries no
// note), so clearing it is a no-op here. The save cell's status is preserved,
// so a save still in flight stays pending.
function draftEdit(state: CardState, draft: CardDraft): CardState {
  return {
    ...state,
    draft,
    dirty: true,
    actions: { ...state.actions, save: { ...state.actions.save, detail: '' } },
    notes: { ...state.notes, deps: '' },
  }
}

// draftDiscard resets the draft from the summary (the persisted values) and
// clears dirty. With no summary yet there is nothing to reset to, so the draft
// clears to null.
function draftDiscard(state: CardState): CardState {
  if (state.summary === null) {
    return { ...state, draft: null, dirty: false }
  }
  const draft: CardDraft = {
    engine: state.summary.engineId,
    config: state.summary.config,
    platform: state.summary.platformConfigs,
  }
  return { ...state, draft, dirty: false }
}

// actionEnter starts one action's round trip: the cell moves to pending with
// an empty detail, the previous result (if any) gone.
function actionEnter(state: CardState, key: ActionKey): CardState {
  return {
    ...state,
    actions: { ...state.actions, [key]: { status: 'pending', detail: '' } },
  }
}

// actionSettle settles one action cell to ok or error, but only while it is
// still pending: a late ack or fail after the deadline timer moved the cell to
// error is a no-op, so the timeout detail the control shows is never clobbered
// by a result that arrived too late.
function actionSettle(
  state: CardState,
  key: ActionKey,
  status: 'ok' | 'error',
  detail: string,
): CardState {
  if (state.actions[key].status !== 'pending') {
    return state
  }
  return {
    ...state,
    actions: { ...state.actions, [key]: { status, detail } },
  }
}

// templateEnter starts the chat-template auto-download round trip: the cell
// moves to pending with an empty detail.
function templateEnter(state: CardState): CardState {
  return {
    ...state,
    templateActions: { download: { status: 'pending', detail: '' } },
  }
}

// templateSettle settles the template-download cell to ok or error, but only
// while it is still pending, the same late-ack-is-a-no-op rule the action
// cells follow.
function templateSettle(
  state: CardState,
  status: 'ok' | 'error',
  detail: string,
): CardState {
  if (state.templateActions.download.status !== 'pending') {
    return state
  }
  return {
    ...state,
    templateActions: { download: { status, detail } },
  }
}

// launchMove drives one provider's machine through launchNextState, reading
// the current entry from the store so a late event prices the state it lands
// on, not a stale one. The machine stays pure, so the reducer stamps the
// startTime the deadline timers arm off. A provider with no entry prices as
// idle, so a provider running per the summary with no machine entry can be
// stopped.
function launchMove(
  state: CardState,
  providerId: string,
  event: Parameters<typeof launchNextState>[1],
): CardState {
  const entry = state.launch[providerId] ?? null
  const next = launchNextState(entry, event)
  return {
    ...state,
    launch: {
      ...state.launch,
      [providerId]: { ...next, startTime: Date.now() },
    },
  }
}
