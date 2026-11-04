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
import { hasInFlightGet } from "./abort.js";
/**
 * editingProvider resolves the provider entry the form is editing, if any:
 * the summary entry whose id matches ui.editingProviderId. A stale id (the
 * entry was deleted) or no id reads as undefined, so the control falls back
 * to the draft.
 */
function editingProvider(state) {
    if (state.ui.editingProviderId === null) {
        return undefined;
    }
    const providers = state.summary?.providers ?? [];
    return providers.find((provider) => provider.id === state.ui.editingProviderId);
}
// phaseLabelFor maps a machine status to the throbber label it renders, or
// undefined when the status is not a throbber state (idle, running, failed).
// The model fetch (downloading) shares the download-phase label, so the
// title bar mirrors the entry's Launch button while the engine fetches files.
function phaseLabelFor(status, t) {
    if (status === undefined) {
        return undefined;
    }
    switch (status) {
        case 'prereqs':
            return t.entryPrereqs;
        case 'download':
        case 'downloading':
            return t.entryDownloading;
        case 'build':
            return t.entryBuilding;
        case 'launch':
            return t.entryLaunching;
        case 'stopping':
            return t.stopping;
        default:
            return undefined;
    }
}
/**
 * deriveLaunchDisabled reports whether the Launch side of the control is
 * gated: a Get run in flight, or the deps panel reporting an unsatisfied
 * dependency. The control applies it only while it reads as Launch (not
 * running), so a Stop is never disabled by the gate.
 */
export function deriveLaunchDisabled(state) {
    const getting = state.actions.get.status === 'pending';
    const depsUnsatisfied = state.deps !== null && state.deps.allSatisfied !== true;
    return getting || depsUnsatisfied;
}
// toGb renders a byte count as GB with one decimal, the readout's size unit.
function toGb(bytes) {
    return (bytes / 1e9).toFixed(1);
}
// formatEtaClock renders a seconds count as the readout's mm:ss clock.
function formatEtaClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return minutes + ':' + String(secs).padStart(2, '0');
}
/**
 * formatProgressReadout renders a GetProgressState as the download readout:
 * the download verb, the percent, the done and total amounts in GB, and the
 * remaining time in mm:ss when the bar carries a tail (a finished bar drops
 * the ETA segment). The 'getting' control branch and the provider row
 * (TASK-011) share it, so the readout text has one source.
 */
export function formatProgressReadout(state, t) {
    // The verb and the percent read as one segment (a space apart), the sizes
    // and the ETA as the middle-dot-separated segments that follow.
    const parts = [
        t.gettingVerb + ' ' + state.percent + '%',
        toGb(state.doneBytes) + '/' + toGb(state.totalBytes) + ' GB',
    ];
    if (state.etaSeconds > 0) {
        parts.push(t.gettingEta + ' ' + formatEtaClock(state.etaSeconds));
    }
    return parts.join(' · ');
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
 * used to render.
 */
export function deriveLifecycleControl(state, t) {
    const provider = editingProvider(state);
    const status = provider !== undefined ? state.launch[provider.id]?.status : undefined;
    // A rebuild phase, the model fetch, or a stop in flight for the edited
    // provider: a busy throbber with the phase label, no click.
    const phaseLabel = phaseLabelFor(status, t);
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
        };
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
        };
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
        };
    }
    // The default Launch/Stop. A fresh provider (no machine entry) reads the
    // draft's action cells; an edited provider at idle reads the entry, so its
    // click routes to the entry's launch.
    const isFresh = provider === undefined;
    const launchPending = state.actions.launch.status === 'pending';
    const stopPending = state.actions.stop.status === 'pending';
    const draftRunning = state.actions.launch.status === 'ok' && state.actions.stop.status !== 'ok';
    const running = isFresh ? draftRunning : false;
    // A Get run in flight: a busy throbber with the live download readout,
    // replacing the greyed-out Launch the gate used to render. The registry
    // read covers the idle-cap settle (the cell reads as ok, the run keeps
    // streaming in the background), and the draft reading as running keeps the
    // Stop side, so the branch skips it.
    if (!running && (state.actions.get.status === 'pending' || hasInFlightGet())) {
        const progress = state.ui.getProgress;
        const busyLabel = progress !== null ? formatProgressReadout(progress, t) : t.gettingReadout;
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
        };
    }
    return {
        kind: 'launchStop',
        label: running ? t.stop : t.launch,
        variant: running ? 'ghost' : 'primary',
        busy: isFresh && (launchPending || stopPending),
        busyLabel: isFresh && (launchPending || stopPending)
            ? launchPending
                ? t.launching
                : t.stopping
            : '',
        disabled: !running && deriveLaunchDisabled(state),
        target: isFresh ? 'draft' : 'entry',
        action: running ? 'stop' : 'launch',
    };
}
/**
 * deriveDisplayedLogs is the Logs section's text: the streamed Get buffer
 * while a run is in flight, else the summary's persisted last-run logs, else
 * the empty string. One value the auto-scroll effect and the textarea share.
 */
export function deriveDisplayedLogs(state) {
    if (state.ui.logs.getLogs !== null) {
        return state.ui.logs.getLogs;
    }
    const lastLogs = state.summary?.lastLogs;
    return lastLogs !== undefined && lastLogs !== '' ? lastLogs : '';
}
/**
 * deriveProviderFormMode is the provider form's effective mode: forced to
 * 'new' when the summary has zero providers (the form is where the first
 * provider is entered), else the stored mode.
 */
export function deriveProviderFormMode(state) {
    if (state.summary !== null && state.summary.providers.length === 0) {
        return 'new';
    }
    return state.ui.providerFormMode;
}
//# sourceMappingURL=derive.js.map
