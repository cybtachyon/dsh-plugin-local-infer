/**
 * The card's pure derivations: the read-only projections a component renders
 * from, computed from the store snapshot with no state of their own.
 *
 * deriveLifecycleControl is the single title-bar control spec that replaces
 * the hand-written card's 4-way conditional over four mirrored "is the engine
 * running" sources. It reads the per-provider launch machine (the only
 * lifecycle source) for the provider being edited, and falls back to the
 * draft's action cells for a fresh provider with no machine entry, so the
 * title-bar control and the provider entry's Launch button always agree. A
 * Get run in flight (the get cell pending, or the in-flight registry true
 * after the idle cap settled the cell) renders a 'getting' throbber with the
 * live download readout. isGettingInFlight is the single source of that
 * condition, shared by the branch and the provider row. formatProgressReadout
 * renders the readout from a GetProgressState, the single source the branch
 * and the provider row share, and phaseLabelFor is the single source of the
 * launch-status to throbber-label map, shared by the branch and the per-entry
 * Launch button. deriveDisplayedLogs, deriveProviderFormMode, and
 * deriveLaunchDisabled are the remaining render-time projections the card
 * needs.
 * @module dsh-plugin-local-infer/client/store/derive
 */

import type { ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui'
import type { LaunchStatus } from '../machine/launch.ts'
import type { TextTable } from '../text.ts'
import { hasInFlightGet } from './abort.ts'
import type { GetProgressState } from './progress.ts'
import { isLiveRunAttached } from './run-markers.ts'
import type { CardState, ProviderFormMode } from './types.ts'

/** The title-bar control's branches, as the spec's kind reads them. */
export type LifecycleControlKind = 'phase' | 'stop' | 'logs' | 'launchStop' | 'getting'

/** Where a control click routes: the provider entry's machine, or the draft. */
export type LifecycleControlTarget = 'entry' | 'draft'

/** The action a control click fires for its target. */
export type LifecycleControlAction = 'launch' | 'stop' | 'logs' | 'none'

/**
 * LifecycleControl is the title-bar Launch/Stop control spec a component
 * renders from. kind names the branch, label and variant drive the render,
 * busy and busyLabel drive the throbber, disabled gates the click, and target
 * plus action route the click to the owning action (the provider entry's
 * machine, or the draft's action cells). progress carries the live download
 * state the 'getting' branch renders as the progress strip; it is absent on
 * every other branch. warn marks a sudo wait: the renderers paint the
 * label's text with the styles SUDO_STATE_LABEL_COLOR token; it is absent
 * on every other state.
 */
export interface LifecycleControl {
  kind: LifecycleControlKind
  label: string
  variant: 'ghost' | 'primary'
  busy: boolean
  busyLabel: string
  disabled: boolean
  target: LifecycleControlTarget
  action: LifecycleControlAction
  progress?: GetProgressState | null
  warn?: boolean
}

/**
 * editingProvider resolves the provider entry the form is editing, if any:
 * the summary entry whose id matches ui.editingProviderId. A stale id (the
 * entry was deleted) or no id reads as undefined, so the control falls back
 * to the draft.
 */
function editingProvider(state: CardState): ProviderSummaryEntry | undefined {
  if (state.ui.editingProviderId === null) {
    return undefined
  }
  const providers = state.summary?.providers ?? []
  return providers.find((provider) => provider.id === state.ui.editingProviderId)
}

/**
 * phaseLabelFor maps a machine status to the throbber label it renders, or
 * undefined when the status is not a throbber state (idle, running, failed).
 * The model fetch (downloading) shares the download-phase label, so the
 * title bar mirrors the entry's Launch button while the engine fetches files.
 * The 'getting' control branch and the per-entry Launch button
 * (render/ProviderList.tsx) share it, so the phase labels have one source.
 */
export function phaseLabelFor(
  status: LaunchStatus | undefined,
  t: TextTable,
): string | undefined {
  if (status === undefined) {
    return undefined
  }
  switch (status) {
    case 'prereqs':
      return t.entryPrereqs
    case 'download':
    case 'downloading':
      return t.entryDownloading
    case 'build':
      return t.entryBuilding
    case 'sudo':
      return t.entrySudo
    case 'launch':
      return t.entryLaunching
    case 'stopping':
      return t.stopping
    default:
      return undefined
  }
}

/**
 * deriveLaunchDisabled reports whether the Launch side of the control is
 * gated: a Get run in flight, or the deps panel reporting an unsatisfied
 * dependency. The control applies it only while it reads as Launch (not
 * running), so a Stop is never disabled by the gate.
 */
export function deriveLaunchDisabled(state: CardState): boolean {
  return isGettingInFlight(state) || (state.deps !== null && state.deps.allSatisfied !== true)
}

/**
 * isGettingInFlight reports whether a Get run is in flight: the get action
 * cell pending, or the in-flight registry true after the idle cap settled the
 * cell. The 'getting' control branch, the provider row, and the Launch gate
 * share it, so the surfaces agree on when a Get is in flight.
 */
export function isGettingInFlight(state: CardState): boolean {
  return state.actions.get.status === 'pending' || hasInFlightGet()
}

/**
 * isLiveRunInFlight reports whether a provider process is live from the
 * card's side: a Get run in flight (isGettingInFlight), any driver-started
 * run in flight, or the pane following an attached run-log stream (the
 * run-markers registry). The Logs pane renders its step chips and the Cancel
 * pill from it, so the pane reads the launch, stop, download, and install
 * processes the way it reads a Get, not only the Get cell.
 */
export function isLiveRunInFlight(state: CardState): boolean {
  return isGettingInFlight(state) || isLiveRunAttached()
}

// toGb renders a byte count as GB with one decimal, the readout's size unit.
function toGb(bytes: number): string {
  return (bytes / 1e9).toFixed(1)
}

// The seconds a minute carries: the readout's mm:ss clock.
const SECONDS_PER_MINUTE = 60

// formatEtaClock renders a seconds count as the readout's mm:ss clock.
function formatEtaClock(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const secs = seconds % SECONDS_PER_MINUTE
  return minutes + ':' + String(secs).padStart(2, '0')
}

// sizeSegment renders the done/total amounts in the unit the bar measured:
// a file count (`43/102 files`) for the file-count bar, GB for the byte bar.
// An absent unit (a progress event from a host that predates the field)
// reads as bytes, the byte-bar rendering.
function sizeSegment(state: GetProgressState, t: TextTable): string {
  if (state.unit === 'files') {
    return state.doneBytes + '/' + state.totalBytes + ' ' + t.gettingFiles
  }
  return toGb(state.doneBytes) + '/' + toGb(state.totalBytes) + ' GB'
}

// The separator between the readout's segments (the verb, the sizes, the
// ETA) and between a title and an appended readout. One constant, so the
// 'getting' control branch and the provider row share the readout text and
// its spacing.
export const PROGRESS_READOUT_SEPARATOR = ' · '

/**
 * formatProgressReadout renders a GetProgressState as the download readout:
 * the download verb, the percent, the done and total amounts in the unit the
 * bar measured (a file count for the file-count bar, GB for the byte bar),
 * and the remaining time in mm:ss when the bar carries a tail (a finished
 * bar drops the ETA segment). The 'getting' control branch and the provider
 * row share it, so the readout text has one source.
 */
export function formatProgressReadout(
  state: GetProgressState,
  t: TextTable,
): string {
  // The verb and the percent read as one segment (a space apart), the sizes
  // and the ETA as the middle-dot-separated segments that follow.
  const parts = [
    t.gettingVerb + ' ' + state.percent + '%',
    sizeSegment(state, t),
  ]
  if (state.etaSeconds > 0) {
    parts.push(t.gettingEta + ' ' + formatEtaClock(state.etaSeconds))
  }
  return parts.join(PROGRESS_READOUT_SEPARATOR)
}

// deriveGettingControl builds the 'getting' control spec: a busy throbber
// with the live download readout (the plain getting label while no progress
// state has landed) and the progress state the strip renders. target routes
// the click to the draft for a fresh provider and to the entry for an
// edited one.
function deriveGettingControl(
  state: CardState,
  t: TextTable,
  isFresh: boolean,
): LifecycleControl {
  const progress = state.ui.getProgress
  const busyLabel =
    progress !== null ? formatProgressReadout(progress, t) : t.gettingReadout
  return {
    kind: 'getting',
    label: busyLabel,
    variant: 'ghost',
    busy: true,
    busyLabel,
    disabled: false,
    target: isFresh ? 'draft' : 'entry',
    action: 'none',
    progress,
  }
}

/**
 * deriveLifecycleControl computes the title-bar control spec from the store.
 * For the provider being edited it reads that provider's launch machine: a
 * rebuild phase, the model fetch, or a stop in flight renders a busy throbber
 * with the phase label (no click); running renders a ghost Stop; failed
 * renders a red Logs. With no machine entry (a fresh provider, or an edited
 * provider at idle) it renders the draft-based Launch/Stop, reading the
 * draft's action cells for a fresh provider and routing the click to the
 * entry for an edited one. A Get run in flight renders the 'getting'
 * throbber with the live readout instead of the greyed-out Launch the gate
 * used to render. A sudo wait renders the "Sudo needed" warn throbber from
 * the machine's sudo status, or from the ui sudoPending flag for a fresh
 * draft (its control has no machine entry to read).
 */
export function deriveLifecycleControl(
  state: CardState,
  t: TextTable,
): LifecycleControl {
  const provider = editingProvider(state)
  const status = provider !== undefined ? state.launch[provider.id]?.status : undefined

  // A rebuild phase, the model fetch, or a stop in flight for the edited
  // provider: a busy throbber with the phase label, no click. The sudo
  // state's throbber carries the warn marker the renderers paint the
  // warning token color from.
  const phaseLabel = phaseLabelFor(status, t)
  if (phaseLabel !== undefined) {
    return {
      kind: 'phase',
      label: phaseLabel,
      variant: 'ghost',
      busy: true,
      busyLabel: phaseLabel,
      disabled: false,
      target: 'entry',
      action: 'none',
      ...(status === 'sudo' ? { warn: true } : {}),
    }
  }

  // The fresh-draft form's sudo wait: its control has no machine entry to
  // read, so the ui flag performDraftLaunch sets drives the same sudo
  // throbber. It prices only when no machine state claims the control.
  if (status === undefined && state.ui.sudoPending) {
    return {
      kind: 'phase',
      label: t.entrySudo,
      variant: 'ghost',
      busy: true,
      busyLabel: t.entrySudo,
      disabled: false,
      target: 'draft',
      action: 'none',
      warn: true,
    }
  }

  // The edited provider is running: a ghost Stop that drives the entry.
  if (status === 'running') {
    return {
      kind: 'stop',
      label: t.stop,
      variant: 'ghost',
      busy: false,
      busyLabel: '',
      disabled: false,
      target: 'entry',
      action: 'stop',
    }
  }

  // The edited provider failed: a red Logs that opens the entry.
  if (status === 'failed') {
    return {
      kind: 'logs',
      label: t.entryLogs,
      variant: 'ghost',
      busy: false,
      busyLabel: '',
      disabled: false,
      target: 'entry',
      action: 'logs',
    }
  }

  // The default Launch/Stop. A fresh provider (no machine entry) reads the
  // draft's action cells; an edited provider at idle reads the entry, so its
  // click routes to the entry's launch.
  const isFresh = provider === undefined
  const launchPending = state.actions.launch.status === 'pending'
  const stopPending = state.actions.stop.status === 'pending'
  const draftRunning =
    state.actions.launch.status === 'ok' && state.actions.stop.status !== 'ok'
  const running = isFresh ? draftRunning : false

  // A Get run in flight: a busy throbber with the live download readout,
  // replacing the greyed-out Launch the gate used to render. The registry
  // read covers the idle-cap settle (the cell reads as ok, the run keeps
  // streaming in the background), and the draft reading as running keeps the
  // Stop side, so the branch skips it.
  if (!running && isGettingInFlight(state)) {
    return deriveGettingControl(state, t, isFresh)
  }

  return {
    kind: 'launchStop',
    label: running ? t.stop : t.launch,
    variant: running ? 'ghost' : 'primary',
    busy: isFresh && (launchPending || stopPending),
    busyLabel:
      isFresh && (launchPending || stopPending)
        ? launchPending
          ? t.launching
          : t.stopping
        : '',
    disabled: !running && deriveLaunchDisabled(state),
    target: isFresh ? 'draft' : 'entry',
    action: running ? 'stop' : 'launch',
  }
}

/**
 * deriveDisplayedLogs is the Logs section's text: the live run-log buffer
 * (the attached stream's text, or a driver's own appends) while one is in
 * place, else the summary's persisted last-run logs, else the empty string.
 * One value the auto-scroll effect and the textarea share.
 */
export function deriveDisplayedLogs(state: CardState): string {
  if (state.ui.logs.liveLogs !== null) {
    return state.ui.logs.liveLogs
  }
  const lastLogs = state.summary?.lastLogs
  return lastLogs !== undefined && lastLogs !== '' ? lastLogs : ''
}

/**
 * deriveProviderFormMode is the provider form's effective mode: forced to
 * 'new' when the summary has zero providers (the form is where the first
 * provider is entered), else the stored mode.
 */
export function deriveProviderFormMode(state: CardState): ProviderFormMode {
  if (state.summary !== null && state.summary.providers.length === 0) {
    return 'new'
  }
  return state.ui.providerFormMode
}
