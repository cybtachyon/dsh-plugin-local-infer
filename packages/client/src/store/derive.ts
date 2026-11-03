/**
 * The card's pure derivations: the read-only projections a component renders
 * from, computed from the store snapshot with no state of their own.
 *
 * deriveLifecycleControl is the single title-bar control spec that replaces
 * the hand-written card's 4-way conditional over four mirrored "is the engine
 * running" sources. It reads the per-provider launch machine (the only
 * lifecycle source) for the provider being edited, and falls back to the
 * draft's action cells for a fresh provider with no machine entry, so the
 * title-bar control and the provider entry's Launch button always agree.
 * deriveDisplayedLogs, deriveProviderFormMode, and deriveLaunchDisabled are
 * the remaining render-time projections the card needs.
 * @module dsh-plugin-local-infer/client/store/derive
 */

import type { ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui'
import type { LaunchStatus } from '../machine/launch.ts'
import type { TextTable } from '../text.ts'
import type { CardState, ProviderFormMode } from './types.ts'

/** The title-bar control's branches, as the spec's kind reads them. */
export type LifecycleControlKind = 'phase' | 'stop' | 'logs' | 'launchStop'

/** Where a control click routes: the provider entry's machine, or the draft. */
export type LifecycleControlTarget = 'entry' | 'draft'

/** The action a control click fires for its target. */
export type LifecycleControlAction = 'launch' | 'stop' | 'logs' | 'none'

/**
 * LifecycleControl is the title-bar Launch/Stop control spec a component
 * renders from. kind names the branch, label and variant drive the render,
 * busy and busyLabel drive the throbber, disabled gates the click, and target
 * plus action route the click to the owning action (the provider entry's
 * machine, or the draft's action cells).
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

// phaseLabelFor maps a machine status to the throbber label it renders, or
// undefined when the status is not a throbber state (idle, running, failed).
// The model fetch (downloading) shares the download-phase label, so the
// title bar mirrors the entry's Launch button while the engine fetches files.
function phaseLabelFor(
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
  const getting = state.actions.get.status === 'pending'
  const depsUnsatisfied = state.deps !== null && state.deps.allSatisfied !== true
  return getting || depsUnsatisfied
}

/**
 * deriveLifecycleControl computes the title-bar control spec from the store.
 * For the provider being edited it reads that provider's launch machine: a
 * rebuild phase, the model fetch, or a stop in flight renders a busy throbber
 * with the phase label (no click); running renders a ghost Stop; failed
 * renders a red Logs. With no machine entry (a fresh provider, or an edited
 * provider at idle) it renders the draft-based Launch/Stop, reading the
 * draft's action cells for a fresh provider and routing the click to the
 * entry for an edited one.
 */
export function deriveLifecycleControl(
  state: CardState,
  t: TextTable,
): LifecycleControl {
  const provider = editingProvider(state)
  const status = provider !== undefined ? state.launch[provider.id]?.status : undefined

  // A rebuild phase, the model fetch, or a stop in flight for the edited
  // provider: a busy throbber with the phase label, no click.
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
 * deriveDisplayedLogs is the Logs section's text: the streamed Get buffer
 * while a run is in flight, else the summary's persisted last-run logs, else
 * the empty string. One value the auto-scroll effect and the textarea share.
 */
export function deriveDisplayedLogs(state: CardState): string {
  if (state.ui.logs.getLogs !== null) {
    return state.ui.logs.getLogs
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
