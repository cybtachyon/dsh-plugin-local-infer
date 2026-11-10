/**
 * The card's pure derivations: the read-only projections a component renders
 * from, computed from the store snapshot with no state of their own.
 *
 * deriveLifecycleControl is the single title-bar control spec that replaces
 * the hand-written card's 4-way conditional over four mirrored "is the engine
 * running" sources. It reads the per-provider launch machine (the only
 * lifecycle source) for the provider being edited, and falls back to the
 * draft's action cells for a fresh provider with no machine entry, so the
 * title-bar control and the provider entry's Launch button always agree. An
 * edited provider whose machine is idle or absent prices the summary's
 * provider status into the Stop side (the same read the provider row gives a
 * running engine with a lost machine). A
 * Get run in flight (the get cell pending, or the in-flight registry true
 * after the idle cap settled the cell) renders a 'getting' throbber with the
 * live download readout. isGettingInFlight is the single source of that
 * condition, shared by the branch and the provider row. formatProgressReadout
 * renders the readout from a GetProgressState, the single source the branch
 * and the provider row share, and phaseLabelFor resolves the throbber label
 * from the launch machine's own LAUNCH_STATE_DISPLAY mapping, shared by the
 * branch and the per-entry Launch button. deriveDisplayedLogs, deriveProviderFormMode, and
 * deriveLaunchDisabled are the remaining render-time projections the card
 * needs.
 * @module dsh-plugin-local-infer/client/store/derive
 */
import { type LaunchStatus } from '../machine/launch.ts';
import type { TextTable } from '../text.ts';
import type { GetProgressState } from './progress.ts';
import type { CardState, ProviderFormMode } from './types.ts';
/** The title-bar control's branches, as the spec's kind reads them. */
export type LifecycleControlKind = 'phase' | 'stop' | 'logs' | 'launchStop' | 'getting';
/** Where a control click routes: the provider entry's machine, or the draft. */
export type LifecycleControlTarget = 'entry' | 'draft';
/** The action a control click fires for its target. */
export type LifecycleControlAction = 'launch' | 'stop' | 'logs' | 'none';
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
    kind: LifecycleControlKind;
    label: string;
    variant: 'ghost' | 'primary';
    busy: boolean;
    busyLabel: string;
    disabled: boolean;
    target: LifecycleControlTarget;
    action: LifecycleControlAction;
    progress?: GetProgressState | null;
    warn?: boolean;
}
/**
 * phaseLabelFor maps a machine status to the throbber label it renders, or
 * undefined when the status is not a throbber state (idle, running, failed).
 * It is a thin consumer of the machine's LAUNCH_STATE_DISPLAY mapping: the
 * machine decides which label key an in-flight state shows, this function
 * only looks the key up in the active text table. The 'getting' control
 * branch and the per-entry Launch button (render/ProviderList.tsx) share
 * it, so the phase labels have one source.
 */
export declare function phaseLabelFor(status: LaunchStatus | undefined, t: TextTable): string | undefined;
/**
 * deriveLaunchDisabled reports whether the Launch side of the control is
 * gated: a Get run in flight, or the deps panel reporting an unsatisfied
 * dependency. The control applies it only while it reads as Launch (not
 * running), so a Stop is never disabled by the gate.
 */
export declare function deriveLaunchDisabled(state: CardState): boolean;
/**
 * isGettingInFlight reports whether a Get run is in flight: the get action
 * cell pending, or the in-flight registry true after the idle cap settled the
 * cell. The 'getting' control branch, the provider row, and the Launch gate
 * share it, so the surfaces agree on when a Get is in flight.
 */
export declare function isGettingInFlight(state: CardState): boolean;
/**
 * isLiveRunInFlight reports whether a provider process is live from the
 * card's side: a Get run in flight (isGettingInFlight), any driver-started
 * run in flight, or the pane following an attached run-log stream (the
 * run-markers registry). The Logs pane renders its step chips and the Cancel
 * pill from it, so the pane reads the launch, stop, download, and install
 * processes the way it reads a Get, not only the Get cell.
 */
export declare function isLiveRunInFlight(state: CardState): boolean;
export declare const PROGRESS_READOUT_SEPARATOR = " \u00B7 ";
/**
 * formatProgressReadout renders a GetProgressState as the download readout:
 * the download verb, the percent, the done and total amounts in the unit the
 * bar measured (a file count for the file-count bar, GB for the byte bar),
 * and the remaining time in mm:ss when the bar carries a tail (a finished
 * bar drops the ETA segment). The 'getting' control branch and the provider
 * row share it, so the readout text has one source.
 */
export declare function formatProgressReadout(state: GetProgressState, t: TextTable): string;
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
export declare function deriveLifecycleControl(state: CardState, t: TextTable): LifecycleControl;
/**
 * deriveDisplayedLogs is the Logs section's text: the live run-log buffer
 * (the attached stream's text, or a driver's own appends) while one is in
 * place, else the summary's persisted last-run logs, else the empty string.
 * One value the auto-scroll effect and the textarea share.
 */
export declare function deriveDisplayedLogs(state: CardState): string;
/**
 * deriveProviderFormMode is the provider form's effective mode: forced to
 * 'new' when the summary has zero providers (the form is where the first
 * provider is entered), else the stored mode.
 */
export declare function deriveProviderFormMode(state: CardState): ProviderFormMode;
//# sourceMappingURL=derive.d.ts.map
