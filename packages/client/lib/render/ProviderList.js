/**
 * The provider list: the saved provider entries the summary carries, each a
 * collapsed card with a status dot (green running, red stopped, yellow
 * unsure), an "Engine: Model" title, and Edit / Delete / Launch controls. The
 * "New provider" control sits after the list: a clickable button while a new
 * provider can be started, plain text while the form is already in new mode.
 *
 * The list is a pure draw of the store: the provider rows read the summary's
 * entries, the per-entry Launch button reads the entry's launch machine
 * (state.launch[provider.id]), and the edit / cancel / new / delete / launch /
 * stop / Logs controls ride the store/providers.ts drivers. Each row owns its
 * entry's timer handle and cancels it on unmount, so a settled or abandoned
 * launch or stop never keeps re-fetching the summary.
 * @module dsh-plugin-local-infer/client/render/ProviderList
 */
import { GHOST_BUTTON } from "../styles.js";
import { hasInFlightGet } from "../store/abort.js";
import { deriveProviderFormMode, formatProgressReadout } from "../store/derive.js";
import { cancelProvider, deleteProvider, editProvider, newProvider, openEntryLogs, performEntryLaunch, performEntryStop, } from "../store/providers.js";
import { renderButton, renderProcessButton, renderStateDot, } from "./primitives.js";
import { react } from "./react.js";
// The provider status dot's semantic states (the DSH StateDot contract): a
// running engine is done (green), a stopped one is an error (red), an unsure
// one asks attention (amber).
const STATUS_TO_DOT = {
    running: 'done',
    stopped: 'error',
    unsure: 'warning',
};
// The owner/repo short name the provider title bar renders when an entry
// names a fork (the git repo that overrides the engine default upstream). It
// accepts a protocol URL (https://github.com/owner/repo), an scp-style
// git@host:owner/repo reference, and an already-short owner/repo form,
// stripping a trailing .git. It returns undefined when no repo name is
// present, so the title bar falls back to the engine label.
function repoShortName(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') {
        return undefined;
    }
    const value = ref.trim();
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    let normalized = value;
    if (isUrl) {
        // Drop the scheme and the host segment, leaving owner/repo.
        normalized = normalized
            .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
            .replace(/^[^/]+\//, '');
    }
    else {
        const colon = value.indexOf(':');
        const slash = value.indexOf('/');
        // An scp-style git@host:owner/repo reference: drop the host prefix.
        if (colon !== -1 && (slash === -1 || colon < slash)) {
            normalized = value.slice(colon + 1);
        }
    }
    const segments = normalized.split('/').filter((part) => part !== '');
    if (segments.length === 0) {
        return undefined;
    }
    const last = segments[segments.length - 1];
    if (last === undefined) {
        return undefined;
    }
    const repo = last.replace(/\.git$/, '');
    if (repo === '') {
        return undefined;
    }
    const owner = segments.length > 1 ? segments[segments.length - 2] : undefined;
    return owner !== undefined ? owner + '/' + repo : repo;
}
/**
 * ProviderList renders the saved provider entries: each a collapsed card with
 * a status dot, an "Engine: Model" title, and Edit / Delete / Launch
 * controls. The list renders nothing while there are no entries (the form
 * below, forced into new mode, is the entry point). The "New provider"
 * control sits after the rows.
 */
export function ProviderList(props) {
    const { store, t } = props;
    const state = store.getSnapshot();
    const providers = state.summary?.providers ?? [];
    if (providers.length === 0) {
        return null;
    }
    const engines = state.summary?.engines ?? [];
    const editingId = state.ui.editingProviderId;
    const deletingId = state.ui.deletingProviderId;
    return (react.createElement("div", { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 } },
        providers.map((provider) => (react.createElement(ProviderRow, { key: provider.id, store: store, provider: provider, t: t, engines: engines, editingId: editingId, deletingId: deletingId }))),
        react.createElement(NewProviderControl, { store: store, t: t })));
}
// The "New provider" control that sits after the provider entries. It is a
// clickable button while a new provider can be started (entries exist and the
// form is not already in new-provider mode); it is plain text with no button
// styling while the form is in new-provider mode, since the form is already
// there to enter one.
export function NewProviderControl(props) {
    const { store, t } = props;
    const state = store.getSnapshot();
    const clickable = (state.summary?.providers.length ?? 0) > 0 &&
        deriveProviderFormMode(state) !== 'new';
    if (clickable) {
        return renderButton('ghost', { onClick: () => newProvider(store) }, t.newProvider);
    }
    return (react.createElement("span", { style: {
            fontSize: 12,
            color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.8))',
        } }, t.newProvider));
}
// One provider entry: the status dot, the "Engine: Model (status)" title, the
// Edit (or Cancel, while the entry is the one being edited) and Delete
// controls, and the per-entry Launch control. The row owns the entry's timer
// handle and cancels it on unmount, so a settled or abandoned launch or stop
// never keeps re-fetching the summary.
export function ProviderRow(props) {
    const { store, provider, t, engines, editingId, deletingId } = props;
    const handleRef = react.useRef(null);
    react.useEffect(() => () => {
        handleRef.current?.cancel();
    }, []);
    const state = store.getSnapshot();
    // A Get run in flight for this row's provider (the one being edited): the
    // get action cell pending, or the in-flight registry true after the idle
    // cap settled the cell. The row swaps its status dot to the ongoing
    // spinner and appends the live download readout to the title.
    const getting = editingId === provider.id &&
        (state.actions.get.status === 'pending' || hasInFlightGet());
    const engineLabel = engines.find((engine) => engine.id === provider.engine)?.label ?? provider.engine;
    // The title bar renders the fork's owner/repo when the entry names a fork,
    // so a forked engine reads as its repo (Ninfer/ninfer-all) rather than the
    // engine label (NInfer). No fork, or an unparseable one, keeps the label.
    const forkName = repoShortName(provider.platform?.engineFork);
    const titleLabel = forkName !== undefined ? forkName : engineLabel;
    const modelLabel = provider.model !== '' ? provider.model : t.modelAuto;
    const statusLabel = {
        running: t.statusRunning,
        stopped: t.statusStopped,
        unsure: t.statusUnsure,
    }[provider.status] ?? provider.status;
    let title;
    if (getting) {
        // The getting readout: the title reads the getting status, and the live
        // progress state (when one has landed) appends the download readout.
        const progress = state.ui.getProgress;
        const readout = progress !== null ? ' · ' + formatProgressReadout(progress, t) : '';
        title = titleLabel + ': ' + modelLabel + ' (' + t.gettingReadout + ')' + readout;
    }
    else {
        title = titleLabel + ': ' + modelLabel + ' (' + statusLabel + ')';
    }
    // The status dot: the ongoing spinner while a Get is in flight, the
    // status-mapped dot otherwise.
    const dotState = getting ? 'ongoing' : (STATUS_TO_DOT[provider.status] ?? 'idle');
    return (react.createElement("div", { style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            border: '1px solid rgba(127,127,127,0.25)',
            borderRadius: 6,
        } },
        renderStateDot(dotState),
        react.createElement("span", { style: {
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }, title: title, "aria-label": title }, title),
        editingId === provider.id
            ? renderButton('ghost', { onClick: () => cancelProvider(store, provider.id) }, t.cancel)
            : renderButton('ghost', { onClick: () => editProvider(store, provider) }, t.edit),
        renderButton('ghost', {
            onClick: () => {
                void deleteProvider(store, provider.id);
            },
            disabled: deletingId === provider.id,
        }, t.delete),
        react.createElement(EntryLaunchButton, { store: store, provider: provider, t: t, handleRef: handleRef })));
}
// The per-entry Launch control: a card entry's own lifecycle button, shown
// alongside its Edit and Delete controls. Idle reads as a Launch button that
// starts the entry's engine; a rebuild in flight shows a disabled control with
// the spinner and the phase label (Prereqs, Downloading, Building, Launching);
// a healthy engine reads as an enabled Stop; a launch that timed out reads as
// a red Logs control that opens the entry for editing. The control reads the
// entry's launch machine (the only lifecycle source), so it always agrees with
// the title-bar control.
export function EntryLaunchButton(props) {
    const { store, provider, t, handleRef } = props;
    const state = store.getSnapshot();
    const status = state.launch[provider.id]?.status ?? 'idle';
    // A rebuild phase in flight: a disabled control with the spinner and the
    // phase label, so the button reads the step that is actually running. The
    // lookup is a string-keyed map (not a 4-key object), so a non-phase status
    // reads as undefined and falls through to the Stop / Logs / Launch branches.
    const phaseLabels = {
        prereqs: t.entryPrereqs,
        download: t.entryDownloading,
        build: t.entryBuilding,
        launch: t.entryLaunching,
    };
    const phaseLabel = phaseLabels[status];
    if (phaseLabel !== undefined) {
        return renderProcessButton({
            busy: true,
            label: phaseLabel,
            busyLabel: phaseLabel,
            variant: 'ghost',
            onClick: () => { },
        });
    }
    // A stop in flight: a disabled control with the spinner and the stopping
    // label, the same throbber the launch phases show.
    if (status === 'stopping') {
        return renderProcessButton({
            busy: true,
            label: t.stopping,
            busyLabel: t.stopping,
            variant: 'ghost',
            onClick: () => { },
        });
    }
    // The engine is fetching its model files (the Strata download): a busy
    // throbber that reads as in progress, not a failure. The card re-polls (a
    // re-launch) until the engine reports ready.
    if (status === 'downloading') {
        return renderProcessButton({
            busy: true,
            label: t.entryDownloading,
            busyLabel: t.entryDownloading,
            variant: 'ghost',
            onClick: () => { },
        });
    }
    // The Stop control reads from the provider status dot, not just the
    // per-entry launch state: the launch state is lost when the user navigates
    // away from the plugin page and back, so a running engine (a green dot) must
    // keep the control as Stop, not reset to Launch.
    if (status === 'running' || provider.status === 'running') {
        return renderButton('ghost', {
            onClick: () => {
                handleRef.current = performEntryStop(store, provider);
            },
        }, t.entryStop);
    }
    if (status === 'failed') {
        // A launch that timed out or failed: a red Logs control that opens the
        // entry for editing and clears the failed state, so the control reads as
        // Launch again and the user can fix the config and re-launch.
        return (react.createElement("button", { type: "button", onClick: () => {
                openEntryLogs(store, provider);
            }, style: { color: 'var(--dsw-alias-label-error, #ff3b30)', ...GHOST_BUTTON }, "aria-label": t.entryLogs }, t.entryLogs));
    }
    // Idle: a plain Launch control that starts the entry's own engine.
    return renderButton('ghost', {
        onClick: () => {
            handleRef.current = performEntryLaunch(store, provider, t);
        },
    }, t.entryLaunch);
}
//# sourceMappingURL=ProviderList.js.map
