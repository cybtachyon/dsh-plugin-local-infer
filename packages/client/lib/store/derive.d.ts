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
 * live download readout. formatProgressReadout renders that readout from a
 * GetProgressState, the single source the branch and the provider row share.
 * deriveDisplayedLogs, deriveProviderFormMode, and deriveLaunchDisabled are
 * the remaining render-time projections the card needs.
 * @module dsh-plugin-local-infer/client/store/derive
 */
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
 * every other branch.
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
}
/**
 * deriveLaunchDisabled reports whether the Launch side of the control is
 * gated: a Get run in flight, or the deps panel reporting an unsatisfied
 * dependency. The control applies it only while it reads as Launch (not
 * running), so a Stop is never disabled by the gate.
 */
export declare function deriveLaunchDisabled(state: CardState): boolean;
/**
 * formatProgressReadout renders a GetProgressState as the download readout:
 * the download verb, the percent, the done and total amounts in GB, and the
 * remaining time in mm:ss when the bar carries a tail (a finished bar drops
 * the ETA segment). The 'getting' control branch and the provider row
 * (TASK-011) share it, so the readout text has one source.
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
 * used to render.
 */
export declare function deriveLifecycleControl(state: CardState, t: TextTable): LifecycleControl;
/**
 * deriveDisplayedLogs is the Logs section's text: the streamed Get buffer
 * while a run is in flight, else the summary's persisted last-run logs, else
 * the empty string. One value the auto-scroll effect and the textarea share.
 */
export declare function deriveDisplayedLogs(state: CardState): string;
/**
 * deriveProviderFormMode is the provider form's effective mode: forced to
 * 'new' when the summary has zero providers (the form is where the first
 * provider is entered), else the stored mode.
 */
export declare function deriveProviderFormMode(state: CardState): ProviderFormMode;
//# sourceMappingURL=derive.d.ts.map
