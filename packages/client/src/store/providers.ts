/**
 * The provider list drivers: the edit, cancel, new, and delete actions the
 * provider list runs, plus the per-entry launch, stop, and Logs actions the
 * entry's lifecycle control runs.
 *
 * The list actions (edit, cancel, new, delete) move the provider form and the
 * draft through the store: a load stores a named draft without marking it
 * dirty (draft/load), and a delete rides the provider-delete route and stores
 * the fresh summary. The per-entry launch and stop drive the per-provider
 * launch machine through launch/move events, so the entry's control and the
 * title-bar control read the same lifecycle. The launch health-poll and sudo
 * deadlines and the stop fast-poll arm off the machine's timers, and each driver
 * returns a handle the panel owns: cancel clears the pending timers and marks
 * the run settled, so a late stream event or poll tick after an unmount never
 * moves the machine.
 * @module dsh-plugin-local-infer/client/store/providers
 */

import {
  postLaunch,
  postProviderDelete,
  postStop,
  type LaunchRequest,
} from '../api/routes.ts'
import {
  LAUNCH_HEALTH_DEADLINE_MS,
  STOP_HEALTH_DEADLINE_MS,
  STOP_POLL_MS,
  type LaunchEvent,
} from '../machine/launch.ts'
import type { ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui'
import type { TextTable } from '../text.ts'
import {
  cancelInFlightRuns,
  forgetLaunchAbort,
  trackLaunchAbort,
} from './abort.ts'
import { repriceAll, repriceSummary } from './deps.ts'
import {
  appendCanceledLog,
  appendProcessLog,
  separatorLine,
  SUDO_NOTE_LINE,
} from './logs.ts'
import { beginRun, clientRunLogKey, endRun } from './logs-stream.ts'
import { ACTION_TIMEOUTS, performAction, type CardStore } from './sync.ts'
import type { CardDraft, CardUiState, ProviderFormMode } from './types.ts'

/**
 * SUDO_DEADLINE_MS caps the card's wait after a launch stream announces a
 * sudo prompt: the host kills the process at 60 s (core's
 * SUDO_PASSWORD_TIMEOUT_MS) and this card-side deadline just past that cap
 * forces a hung password wait to the red Logs state, the same settle path as
 * the health-poll timeout. The client bundle cannot import the node-side
 * core package, so the number is mirrored here; the two change together by
 * hand.
 */
export const SUDO_DEADLINE_MS = 65_000

/**
 * EntryTimerHandle is the panel's ownership of a per-entry timer: cancel
 * clears the pending poll and deadline timers and marks the run settled, so
 * a late stream event or poll tick after the panel unmounts never moves the
 * machine. A no-op handle (a launch the guard rejected) cancels to nothing.
 */
export interface EntryTimerHandle {
  cancel(): void
}

// noHandle is the handle a guarded-out action returns: nothing to cancel.
const noHandle: EntryTimerHandle = { cancel() {} }

// DeadlineKind names the timeout that owns a launch run's single deadline:
// the health-poll cap armed by the launch step, or the sudo cap armed by a
// password-wait announcement.
type DeadlineKind = 'health' | 'sudo'

// move dispatches one launch/move event for the provider, the single path the
// entry's machine is driven through.
function move(store: CardStore, providerId: string, event: LaunchEvent): void {
  store.dispatch({ type: 'launch/move', providerId, event })
}

// formModeForProviderCount picks the form mode after a provider list change:
// entries remain reads as the collapsed list, an empty list reads as the
// new-provider form.
function formModeForProviderCount(count: number): 'collapsed' | 'new' {
  return count > 0 ? 'collapsed' : 'new'
}

/**
 * abandonedFormPatch builds the ui patch every draft-abandon path dispatches
 * (the Cancel, New provider, Discard, and the delete's form collapse): the
 * form closes and the sudo-wait flag clears in the same patch, so no path can
 * leave a stale flag painting the control "Sudo needed" after its run is
 * gone. All four paths go through this one helper.
 */
export function abandonedFormPatch(
  providerFormMode: ProviderFormMode,
): Pick<CardUiState, 'editingProviderId' | 'providerFormMode' | 'sudoPending'> {
  return { editingProviderId: null, providerFormMode, sudoPending: false }
}

/**
 * editProvider loads a stored provider's engine, config, and platform into
 * the form (the next Save updates that entry in place). It caches the form's
 * current values first (a later "New provider" restores them), opens the form
 * in editing mode, and re-prices the meter and deps panel for the loaded
 * provider's engine.
 */
export function editProvider(store: CardStore, provider: ProviderSummaryEntry): void {
  const state = store.getSnapshot()
  store.dispatch({
    type: 'ui/patch',
    patch: {
      cachedDraft: state.draft,
      editingProviderId: provider.id,
      providerFormMode: 'editing',
    },
  })
  store.dispatch({
    type: 'draft/load',
    draft: {
      engine: provider.engine,
      config: provider.config,
      platform: { [provider.engine]: provider.platform },
      // A stored entry saved before the autoRebuild key existed (or saved
      // while it was never checked) reads as an unchecked checkbox.
      autoRebuild: provider.autoRebuild ?? false,
    },
  })
  void repriceAll(store, { engine: provider.engine, config: provider.config })
}

/**
 * cancelProvider collapses the editing form back to the provider entry list
 * and discards the staged edit: the draft reverts to the summary's stored
 * values, so nothing the user typed in the edit is kept. With no stored
 * entries the form reads as new-provider mode. The Cancel is also the
 * in-flight run's abort: it closes the in-flight Get run's stream and the
 * named provider's in-flight Launch run (the route's response close
 * interrupts the in-flight hf child on the host), and appends the "Canceled"
 * line to the Logs buffer, so the run reads as canceled in the textarea and
 * the log file. The Cancel abandons a draft run's sudo wait too: the shared
 * abandonedFormPatch clears the ui.sudoPending flag so a stale flag can never
 * paint the form control "Sudo needed" after the run is gone.
 */
export function cancelProvider(store: CardStore, providerId?: string): void {
  if (cancelInFlightRuns(providerId)) {
    appendCanceledLog(store)
  }
  const state = store.getSnapshot()
  store.dispatch({
    type: 'ui/patch',
    patch: abandonedFormPatch(formModeForProviderCount(state.summary?.providers.length ?? 0)),
  })
  store.dispatch({ type: 'draft/discard' })
  void repriceAll(store)
}

/**
 * newProvider resets the form to a fresh provider (the next Save mints an id
 * and prepends it). It restores the cached in-progress values (the form state
 * before the last edit); with no cache a fresh provider starts from the
 * current engine and a blank config. Like the Cancel, a new provider abandons
 * a draft run's sudo wait, so the shared abandonedFormPatch clears the
 * ui.sudoPending flag.
 */
export function newProvider(store: CardStore): void {
  const state = store.getSnapshot()
  const next =
    state.ui.cachedDraft !== null
      ? state.ui.cachedDraft
      : {
          engine: state.draft?.engine ?? 'ninfer',
          config: {},
          platform: state.draft?.platform ?? {},
        }
  store.dispatch({ type: 'ui/patch', patch: abandonedFormPatch('new') })
  store.dispatch({ type: 'draft/load', draft: next })
  void repriceAll(store, { engine: next.engine, config: next.config })
}

/**
 * deleteProvider removes a saved provider entry through the provider-delete
 * route and stores the fresh summary. A delete in flight for another entry is
 * a no-op (a second click does not fire a second request). If the form was
 * editing the deleted entry, it stops editing it and collapses back to the
 * entry list (the new-provider form when the delete leaves no entries); the
 * collapse rides the shared abandonedFormPatch, so a draft run's sudo-wait
 * flag clears with the form.
 */
export function deleteProvider(store: CardStore, providerId: string): Promise<void> {
  if (store.getSnapshot().ui.deletingProviderId !== null) {
    return Promise.resolve()
  }
  store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: providerId } })
  return postProviderDelete({ id: providerId })
    .then((summary) => {
      store.dispatch({ type: 'summary/ack', summary })
      const ui = store.getSnapshot().ui
      if (ui.editingProviderId === providerId) {
        // The delete abandons the edited draft: the form closes through the
        // shared patch, so a draft run's sudo-wait flag clears with it.
        store.dispatch({
          type: 'ui/patch',
          patch: abandonedFormPatch(formModeForProviderCount(summary.providers.length)),
        })
      }
      store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: null } })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      store.dispatch({ type: 'summary/fail', note: message })
      store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: null } })
    })
}

/**
 * openEntryLogs opens the entry's red Logs control: it loads the entry for
 * editing AND resets the launch machine, so the per-entry control reads as
 * Launch again and the user fixes the config and re-launches from the same
 * entry.
 */
export function openEntryLogs(store: CardStore, provider: ProviderSummaryEntry): void {
  editProvider(store, provider)
  move(store, provider.id, { type: 'reset' })
}

/**
 * performEntryLaunch runs one card entry's own Launch control: it starts the
 * entry's launch machine at the prereqs phase and reads the launch stream (a
 * step event as each
 * phase begins, then a final result event). Each step event advances the
 * phase label; the build step writes a "Building..." separator; the launch
 * step arms the health-poll deadline (the route's poll runs up to two
 * minutes, so a client-side deadline just past that cap forces a hung launch
 * to the red Logs state); a sudo event moves the machine to sudo, appends the
 * CLI-note line, and arms the shorter sudo deadline through the same settle
 * path. A step event after a sudo wait means the run resumed, so the sudo
 * timer hands the single deadline slot back and the launch step arms the
 * health cap as it always has. A healthy result settles to running (the control
 * becomes Stop), a downloading result settles to downloading (a busy
 * throbber, settled later by the summary ack's summaryStatus fold; see
 * foldDownloading in reducer.ts), and a failed result, a stream that ends
 * without a result, or a fetch failure settles to failed (the control becomes
 * a red Logs). A result re-fetches the summary and deps read models, so the
 * provider's status dot repaints from red to green and the deps panel
 * re-prices. The run's live output reaches the Logs buffer through the
 * attached run-log stream: beginRun names the run key (the host keys this
 * launch on the provider id, per the mirrored runLogKey rule), the run's
 * settle detaches it, and the host's "Launching..." seed arrives through
 * that stream (runBegin/snapshot), never a client-side seed.
 *
 * With a draftOverride (the open provider form's unsaved draft, submitted by
 * the title-bar control), the request carries the DRAFT's engine, config,
 * per-engine platform entry, and Auto Rebuild checkbox through the same
 * top-level keys while providerId stays this entry's: the launch record
 * persists on the entry (lifecycle state, not settings), and the launch
 * never writes the entry's stored values. The run key and the settle
 * re-price then read the draft's engine and config; the machine, phase
 * labels, health/sudo deadlines, and abort tracking stay keyed on the
 * entry's id.
 */
export function performEntryLaunch(
  store: CardStore,
  provider: ProviderSummaryEntry,
  t: TextTable,
  draftOverride?: CardDraft,
): EntryTimerHandle {
  const prior = store.getSnapshot().launch[provider.id]
  const status = prior?.status ?? 'idle'
  // A launch in flight (a rebuild phase) or a stop in flight is ignored; a
  // running engine is stopped by its own Stop control, not re-launched.
  if (status !== 'idle' && status !== 'failed') {
    return noHandle
  }
  // The launch context reads the draft while the form's draft is submitted,
  // else the entry's stored values. An absent draft platform entry reads as
  // no platform override (the host falls back to the stored entry) and an
  // absent draft autoRebuild reads as unchecked, the same rules as a stored
  // entry saved before either key existed.
  const engine = draftOverride?.engine ?? provider.engine
  const config = draftOverride?.config ?? provider.config
  const platform =
    draftOverride === undefined
      ? provider.platform
      : draftOverride.platform?.[draftOverride.engine]
  const autoRebuild =
    (draftOverride !== undefined ? draftOverride.autoRebuild : provider.autoRebuild) ?? false
  // The run key mirrors the host rule on the body it receives: the request's
  // providerId names the key, so the pane follows this entry's run
  // regardless of which engine and config the body carries.
  const runKey = clientRunLogKey(
    store.getSnapshot().summary?.providers ?? [],
    engine,
    config,
    provider.id,
  )
  beginRun(store, runKey)
  move(store, provider.id, { type: 'start' })
  let settled = false
  let deadline: ReturnType<typeof setTimeout> | null = null
  // deadlineKind tracks which timeout owns the armed deadline, so a resumed
  // sudo wait can hand the slot to the health-poll cap instead of the stale
  // sudo timer settling a legitimately launching run.
  let deadlineKind: DeadlineKind | null = null
  const clearDeadline = (): void => {
    if (deadline !== null) {
      clearTimeout(deadline)
      deadline = null
    }
    deadlineKind = null
  }
  // The run's abort: the provider form's Cancel closes the stream through it,
  // and the route's response close interrupts the in-flight Get-step hf child
  // on the host. The unmount cancel clears the timers only, so the run keeps
  // streaming in the background, the same rule the stop driver applies.
  const controller = new AbortController()
  trackLaunchAbort(provider.id, controller)
  // settle marks the run settled and clears its deadline timer and the abort
  // registry entry once, whichever settle path lands first (the unmount
  // cancel, the result, the stream break). It reports whether it was the
  // first settle, so the late paths no-op.
  const settle = (): boolean => {
    if (settled) {
      return false
    }
    settled = true
    clearDeadline()
    forgetLaunchAbort(provider.id)
    endRun(store, runKey)
    return true
  }
  const handle: EntryTimerHandle = {
    cancel() {
      settle()
    },
  }
  // The deadline arms two ways: only for the launch (health-poll) step with
  // the health-poll cap, or on a sudo event with the sudo cap (the rebuild
  // steps before the launch run without a timeout, so a slow build never
  // reads as a failure). One deadline variable, one owner, one settle path,
  // so a hung health poll and a hung password wait both reach the red Logs
  // state through this code path. The owner keeps the slot until the run
  // settles or a step event resumes it out of the sudo wait (see onStep).
  const armDeadline = (kind: DeadlineKind, timeoutMs: number): void => {
    if (deadlineKind !== null || settled) {
      return
    }
    deadlineKind = kind
    deadline = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      move(store, provider.id, { type: 'failed' })
    }, timeoutMs)
  }
  const onStep = (step: string): void => {
    // A reported step means the run resumed (the password landed): a sudo
    // deadline no longer describes the wait, so it is cleared and the slot
    // is free for the launch step's health cap below. A health-poll
    // deadline is never cleared by a step event.
    if (deadlineKind === 'sudo') {
      clearDeadline()
    }
    move(store, provider.id, { type: 'step', step })
    if (step === 'build') {
      appendProcessLog(store, separatorLine(t.entryBuilding))
    }
    if (step === 'launch') {
      armDeadline('health', LAUNCH_HEALTH_DEADLINE_MS)
    }
  }
  // The host announced a password wait on its CLI: the control reads "Sudo
  // needed", the note line tells the user where to type, and the sudo
  // deadline settles the control if the password never lands.
  const onSudo = (): void => {
    move(store, provider.id, { type: 'sudoNeeded' })
    appendProcessLog(store, SUDO_NOTE_LINE)
    armDeadline('sudo', SUDO_DEADLINE_MS)
  }
  postLaunch(
    {
      engine,
      config,
      // The launch route parses platform as ONE per-engine entry (the host's
      // parseStoredPlatformConfig), not the save route's engine-keyed
      // record. exactOptionalPropertyTypes: a draft with no entry omits the
      // key outright (the host then falls back to the stored entry).
      ...(platform === undefined ? {} : { platform }),
      providerId: provider.id,
      // The checkbox in effect: the draft's while the form's draft is
      // submitted, else the entry's stored value; an unchecked run skips the
      // rebuild steps.
      autoRebuild,
    },
    onStep,
    controller.signal,
    onSudo,
  )
    .then((result) => {
      if (settle() !== true) {
        return
      }
      if (result === null) {
        // The stream ended without a result event: settle to failed.
        move(store, provider.id, { type: 'failed' })
      } else if (result.healthy === true) {
        move(store, provider.id, { type: 'healthy' })
      } else if (result.state === 'downloading') {
        move(store, provider.id, { type: 'downloading' })
      } else {
        move(store, provider.id, { type: 'failed' })
      }
      // The provider status dots price the process probe on a summary fetch,
      // so a launch that turned an engine healthy re-fetches the summary and
      // deps read models to repaint the dot and re-price the deps panel. The
      // pair prices the engine and config that actually ran: the draft's when
      // one was submitted.
      void repriceAll(store, { engine, config })
    })
    .catch(() => {
      if (settle() !== true) {
        return
      }
      // An aborted run (the provider form's Cancel) reads as failed, not a
      // stream break: the "Canceled" line the Cancel wrote is the run's tail,
      // and the red Logs control re-opens the entry for a re-launch.
      move(store, provider.id, { type: 'failed' })
    })
  return handle
}

/**
 * performEntryStop runs one card entry's own Stop control: it moves the
 * entry's launch machine to stopping (the control shows the throbber,
 * disabled) and, for the duration of the stop, re-fetches the summary on a
 * fast cadence so the provider's status dot repaints the moment the engine
 * is down. A provider still running when the 10-second deadline fires settles
 * to the red Logs state (the same path a failed launch takes). A stop that
 * fails leaves the entry in its last state; the fast-poll and the deadline
 * settle it. The stop keeps its own deadline pair (poll plus deadline, one
 * settle each) instead of riding the launch driver's armDeadline slot: the
 * launch deadline serves two owners (health and sudo) of one run, while the
 * stop settles through the machine's cause-aware stopFailed event, so the two
 * paths share no timer state to drift apart. The stop brackets one run-log
 * stream (the host keys the stop on the provider id), detached at whichever
 * settle path lands first.
 */
export function performEntryStop(
  store: CardStore,
  provider: ProviderSummaryEntry,
): EntryTimerHandle {
  const prior = store.getSnapshot().launch[provider.id]
  const priorStatus = prior?.status ?? 'idle'
  // A failed launch reads as Logs, not Stop, so a stop only starts from the
  // other states.
  if (priorStatus === 'failed') {
    return noHandle
  }
  const runKey = clientRunLogKey(
    store.getSnapshot().summary?.providers ?? [],
    provider.engine,
    provider.config,
    provider.id,
  )
  beginRun(store, runKey)
  move(store, provider.id, { type: 'stop' })
  let poll: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let settled = false
  const clearTimers = (): void => {
    if (poll !== null) {
      clearTimeout(poll)
      poll = null
    }
    if (deadline !== null) {
      clearTimeout(deadline)
      deadline = null
    }
  }
  const handle: EntryTimerHandle = {
    cancel() {
      settleStop()
    },
  }
  // settleStop ends the run once (its timers and its run-log stream), the
  // single settle the poll, the deadline, and the unmount cancel share.
  const settleStop = (): void => {
    settled = true
    clearTimers()
    endRun(store, runKey)
  }
  const pollFn = (): void => {
    if (settled) {
      return
    }
    // The provider statuses the summary last painted: the fast-poll reads the
    // value the last fetch settled, not a stale closure.
    const entry = (store.getSnapshot().summary?.providers ?? []).find(
      (p) => p.id === provider.id,
    )
    if (entry !== undefined && entry.status !== 'running') {
      // The provider is no longer running: the stop succeeded.
      move(store, provider.id, { type: 'stopped' })
      settleStop()
      return
    }
    // Summary only: stopping an engine does not change the deps the panel prices.
    void repriceSummary(store)
    poll = setTimeout(pollFn, STOP_POLL_MS)
  }
  poll = setTimeout(pollFn, STOP_POLL_MS)
  deadline = setTimeout(() => {
    // The provider is still running after the deadline: settle to the red
    // Logs state, the same path a failed launch takes.
    if (settled) {
      return
    }
    settleStop()
    move(store, provider.id, { type: 'stopFailed' })
  }, STOP_HEALTH_DEADLINE_MS)
  void postStop({
    engine: provider.engine,
    config: provider.config,
    // Same single-entry shape as the launch body (shared host parser).
    platform: provider.platform,
    providerId: provider.id,
  }).catch(() => {
    // A stop that fails leaves the entry in its last state; the fast-poll and
    // the deadline settle it.
  })
  return handle
}

// draftLaunchBody builds the launch/stop body the draft-based control sends:
// the draft's engine, config, and the per-engine platform entry (the unsaved
// Engine Directory / Fork edits), the draft's Auto Rebuild checkbox (an
// absent value launches as unchecked), and the provider id the form is
// editing (the route persists the launch record on that entry).
function draftLaunchBody(store: CardStore): LaunchRequest {
  const state = store.getSnapshot()
  const draft = state.draft
  const platform = draft !== null ? (draft.platform ?? {})[draft.engine] : undefined
  const body: LaunchRequest = {
    autoRebuild: draft?.autoRebuild ?? false,
  }
  if (draft !== null) {
    body.engine = draft.engine
    body.config = draft.config
  }
  if (platform !== undefined && draft !== null) {
    // The route takes the single per-engine entry, not an engine-keyed record.
    body.platform = platform
  }
  if (state.ui.editingProviderId !== null) {
    body.providerId = state.ui.editingProviderId
  }
  return body
}

/**
 * performDraftLaunch runs the form's own Launch control (the title-bar
 * control's draft target): it reads the launch stream (keeping only the result
 * event, the form's control shows no phase labels) and settles the draft's
 * launch cell. A sudo event sets the ui.sudoPending flag the control renders
 * "Sudo needed" from (the draft has no machine entry to read) and the flag
 * clears when the run settles. A healthy result reads as running (the control
 * becomes Stop), a not-healthy or missing result reads as the launch-failed
 * note. The summary and deps read models re-fetch so the provider's status
 * dot repaints and the deps panel re-prices. The run registers
 * its AbortController under the form's provider id (the "draft" key when the
 * form is not a provider), so the provider form's Cancel closes the stream
 * and the route interrupts the in-flight Get-step hf child on the host.
 */
export function performDraftLaunch(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  if (state.draft === null) {
    return Promise.resolve()
  }
  const draft = state.draft
  const abortKey = state.ui.editingProviderId ?? 'draft'
  // The run key follows the request body: draftLaunchBody names the edited
  // provider id when the form is one, so the mirrored key rule picks the same
  // key the host's launch path does (engine+model match, else engine id).
  const runKey = clientRunLogKey(
    state.summary?.providers ?? [],
    draft.engine,
    draft.config,
    state.ui.editingProviderId ?? undefined,
  )
  beginRun(store, runKey)
  const controller = new AbortController()
  trackLaunchAbort(abortKey, controller)
  return performAction(
    store,
    'launch',
    () =>
      postLaunch(
        draftLaunchBody(store),
        undefined,
        controller.signal,
        // The draft control has no machine entry to read, so the sudo wait
        // rides the ui flag; the settle below clears it.
        () => store.dispatch({ type: 'ui/patch', patch: { sudoPending: true } }),
      )
        .then((result) => {
          if (result !== null && result.healthy === true) {
            void repriceAll(store, { engine: draft.engine, config: draft.config })
            return t.runningOn + ' ' + (result.plan !== undefined ? String(result.plan.port) : '')
          }
          if (result !== null) {
            throw new Error(t.notHealthy + (result.detail ? ': ' + result.detail : ''))
          }
          throw new Error(t.launchFailed)
        })
        .catch((error: unknown) => {
          // The run settled (a healthy ack throws nothing, a broken stream or
          // the provider form's Cancel rejects): the controller is no longer
          // in flight, so a later Cancel reads it as nothing to abort.
          forgetLaunchAbort(abortKey)
          throw error
        })
        .finally(() => {
          store.dispatch({ type: 'ui/patch', patch: { sudoPending: false } })
        }),
    ACTION_TIMEOUTS.launch,
  ).then(() => {
    endRun(store, runKey)
  })
}

/**
 * performDraftStop runs the form's own Stop control (the title-bar control's
 * draft target): it signals the tracked process through the stop route and
 * settles the draft's stop cell. A successful stop reads as stopped (the
 * control becomes Launch). The summary and deps read models re-fetch so the
 * provider's status dot repaints and the deps panel re-prices. The round
 * trip brackets one run-log stream with the same one-pair attach the other
 * drivers use (the mirrored runLogKey rule, the edited provider id when the
 * request names one), so the pane follows draft stop output the way it
 * follows the entry Stop's.
 */
export function performDraftStop(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  if (state.draft === null) {
    return Promise.resolve()
  }
  const draft = state.draft
  // The key rule mirrors the stop route's (draftLaunchBody names the edited
  // provider id when the form is one, so the pane follows the same key the
  // host writes the stop under).
  const runKey = clientRunLogKey(
    state.summary?.providers ?? [],
    draft.engine,
    draft.config,
    state.ui.editingProviderId ?? undefined,
  )
  beginRun(store, runKey)
  return performAction(
    store,
    'stop',
    () =>
      postStop(draftLaunchBody(store)).then(() => {
        void repriceAll(store, { engine: draft.engine, config: draft.config })
        return t.stopped
      }),
    ACTION_TIMEOUTS.stop,
  ).then(() => {
    endRun(store, runKey)
  })
}
