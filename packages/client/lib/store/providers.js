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
 * title-bar control read the same lifecycle. The launch health-poll deadline
 * and the stop fast-poll arm off the machine's timers, and each driver
 * returns a handle the panel owns: cancel clears the pending timers and marks
 * the run settled, so a late stream event or poll tick after an unmount never
 * moves the machine.
 * @module dsh-plugin-local-infer/client/store/providers
 */
import { postLaunch, postProviderDelete, postStop } from "../api/routes.js";
import { LAUNCH_HEALTH_DEADLINE_MS, STOP_HEALTH_DEADLINE_MS, STOP_POLL_MS, } from "../machine/launch.js";
import { repriceDeps, repriceSummary } from "./deps.js";
// noHandle is the handle a guarded-out action returns: nothing to cancel.
const noHandle = { cancel() { } };
// move dispatches one launch/move event for the provider, the single path the
// entry's machine is driven through.
function move(store, providerId, event) {
    store.dispatch({ type: 'launch/move', providerId, event });
}
// seedProcessLog writes a "Launching..." separator to the Logs buffer, so the
// run reads as a fresh Logs section the launch appends to.
function seedProcessLog(store, label) {
    const state = store.getSnapshot();
    const base = state.ui.logs.getLogs ?? state.summary?.lastLogs ?? '';
    store.dispatch({
        type: 'ui/patch',
        patch: {
            logs: {
                ...state.ui.logs,
                getLogs: base + (base === '' ? '' : '\n') + '--- ' + label + '\n',
            },
        },
    });
}
// appendProcessLog appends a line to the Logs buffer (the build separator),
// keeping the existing buffer.
function appendProcessLog(store, line) {
    const logs = store.getSnapshot().ui.logs;
    const base = logs.getLogs ?? '';
    store.dispatch({
        type: 'ui/patch',
        patch: { logs: { ...logs, getLogs: base + (base === '' ? '' : '\n') + line } },
    });
}
/**
 * editProvider loads a stored provider's engine, config, and platform into
 * the form (the next Save updates that entry in place). It caches the form's
 * current values first (a later "New provider" restores them), opens the form
 * in editing mode, and re-prices the meter and deps panel for the loaded
 * provider's engine.
 */
export function editProvider(store, provider) {
    const state = store.getSnapshot();
    store.dispatch({
        type: 'ui/patch',
        patch: {
            cachedDraft: state.draft,
            editingProviderId: provider.id,
            providerFormMode: 'editing',
        },
    });
    store.dispatch({
        type: 'draft/load',
        draft: {
            engine: provider.engine,
            config: provider.config,
            platform: { [provider.engine]: provider.platform },
        },
    });
    void repriceSummary(store, { engine: provider.engine, config: provider.config });
    void repriceDeps(store, { engine: provider.engine, config: provider.config });
}
/**
 * cancelProvider collapses the editing form back to the provider entry list
 * and discards the staged edit: the draft reverts to the summary's stored
 * values, so nothing the user typed in the edit is kept. With no stored
 * entries the form reads as new-provider mode.
 */
export function cancelProvider(store) {
    const state = store.getSnapshot();
    const hasProviders = (state.summary?.providers.length ?? 0) > 0;
    store.dispatch({
        type: 'ui/patch',
        patch: {
            editingProviderId: null,
            providerFormMode: hasProviders ? 'collapsed' : 'new',
        },
    });
    store.dispatch({ type: 'draft/discard' });
    void repriceSummary(store);
    void repriceDeps(store);
}
/**
 * newProvider resets the form to a fresh provider (the next Save mints an id
 * and prepends it). It restores the cached in-progress values (the form state
 * before the last edit); with no cache a fresh provider starts from the
 * current engine and a blank config.
 */
export function newProvider(store) {
    const state = store.getSnapshot();
    const next = state.ui.cachedDraft !== null
        ? state.ui.cachedDraft
        : {
            engine: state.draft?.engine ?? 'ninfer',
            config: {},
            platform: state.draft?.platform ?? {},
        };
    store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: null, providerFormMode: 'new' },
    });
    store.dispatch({ type: 'draft/load', draft: next });
    void repriceSummary(store, { engine: next.engine, config: next.config });
    void repriceDeps(store, { engine: next.engine, config: next.config });
}
/**
 * deleteProvider removes a saved provider entry through the provider-delete
 * route and stores the fresh summary. A delete in flight for another entry is
 * a no-op (a second click does not fire a second request). If the form was
 * editing the deleted entry, it stops editing it and collapses back to the
 * entry list (the new-provider form when the delete leaves no entries).
 */
export function deleteProvider(store, providerId) {
    if (store.getSnapshot().ui.deletingProviderId !== null) {
        return Promise.resolve();
    }
    store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: providerId } });
    return postProviderDelete({ id: providerId })
        .then((summary) => {
        store.dispatch({ type: 'summary/ack', summary });
        const ui = store.getSnapshot().ui;
        if (ui.editingProviderId === providerId) {
            store.dispatch({
                type: 'ui/patch',
                patch: {
                    editingProviderId: null,
                    providerFormMode: summary.providers.length > 0 ? 'collapsed' : 'new',
                },
            });
        }
        store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: null } });
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.dispatch({ type: 'summary/fail', note: message });
        store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: null } });
    });
}
/**
 * openEntryLogs opens the entry's red Logs control: it loads the entry for
 * editing AND resets the launch machine, so the per-entry control reads as
 * Launch again and the user fixes the config and re-launches from the same
 * entry.
 */
export function openEntryLogs(store, provider) {
    editProvider(store, provider);
    move(store, provider.id, { type: 'reset' });
}
/**
 * performEntryLaunch runs one card entry's own Launch control: it starts the
 * entry's launch machine at the prereqs phase, seeds the Logs buffer with a
 * "Launching..." separator, and reads the launch stream (a step event as each
 * phase begins, then a final result event). Each step event advances the
 * phase label; the build step writes a "Building..." separator; the launch
 * step arms the health-poll deadline (the route's poll runs up to two
 * minutes, so a client-side deadline just past that cap forces a hung launch
 * to the red Logs state). A healthy result settles to running (the control
 * becomes Stop), a downloading result settles to downloading (a busy
 * throbber the card re-polls), and a failed result, a stream that ends
 * without a result, or a fetch failure settles to failed (the control becomes
 * a red Logs). A result re-fetches the summary so the provider's status dot
 * repaints from red to green.
 */
export function performEntryLaunch(store, provider, t) {
    const prior = store.getSnapshot().launch[provider.id];
    const status = prior?.status ?? 'idle';
    // A launch in flight (a rebuild phase) or a stop in flight is ignored; a
    // running engine is stopped by its own Stop control, not re-launched.
    if (status !== 'idle' && status !== 'failed') {
        return noHandle;
    }
    seedProcessLog(store, t.entryLaunching);
    move(store, provider.id, { type: 'start' });
    let settled = false;
    let deadline = null;
    const clearDeadline = () => {
        if (deadline !== null) {
            clearTimeout(deadline);
            deadline = null;
        }
    };
    const handle = {
        cancel() {
            if (settled) {
                return;
            }
            settled = true;
            clearDeadline();
        },
    };
    // The health-poll deadline arms only for the launch (health-poll) step; the
    // rebuild steps (prereqs, download, build) run without a timeout, so a slow
    // build never reads as a failure.
    const armDeadline = () => {
        if (deadline !== null || settled) {
            return;
        }
        deadline = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            move(store, provider.id, { type: 'failed' });
        }, LAUNCH_HEALTH_DEADLINE_MS);
    };
    const onStep = (step) => {
        move(store, provider.id, { type: 'step', step });
        if (step === 'build') {
            appendProcessLog(store, '--- ' + t.entryBuilding + '\n');
        }
        if (step === 'launch') {
            armDeadline();
        }
    };
    postLaunch({
        engine: provider.engine,
        config: provider.config,
        platform: { [provider.engine]: provider.platform },
        providerId: provider.id,
    }, onStep)
        .then((result) => {
        if (settled) {
            return;
        }
        settled = true;
        clearDeadline();
        if (result === null) {
            // The stream ended without a result event: settle to failed.
            move(store, provider.id, { type: 'failed' });
        }
        else if (result.healthy === true) {
            move(store, provider.id, { type: 'healthy' });
        }
        else if ('state' in result && result.state === 'downloading') {
            move(store, provider.id, { type: 'downloading' });
        }
        else {
            move(store, provider.id, { type: 'failed' });
        }
        // The provider status dots price the process probe on a summary fetch,
        // so a launch that turned an engine healthy re-fetches the summary to
        // repaint the dot from red to green.
        void repriceSummary(store, { engine: provider.engine, config: provider.config });
    })
        .catch(() => {
        if (settled) {
            return;
        }
        settled = true;
        clearDeadline();
        move(store, provider.id, { type: 'failed' });
    });
    return handle;
}
/**
 * performEntryStop runs one card entry's own Stop control: it moves the
 * entry's launch machine to stopping (the control shows the throbber,
 * disabled) and, for the duration of the stop, re-fetches the summary on a
 * fast cadence so the provider's status dot repaints the moment the engine
 * is down. A provider still running when the 10-second deadline fires settles
 * to the red Logs state (the same path a failed launch takes). A stop that
 * fails leaves the entry in its last state; the fast-poll and the deadline
 * settle it.
 */
export function performEntryStop(store, provider) {
    const prior = store.getSnapshot().launch[provider.id];
    const priorStatus = prior?.status ?? 'idle';
    // A failed launch reads as Logs, not Stop, so a stop only starts from the
    // other states.
    if (priorStatus === 'failed') {
        return noHandle;
    }
    move(store, provider.id, { type: 'stop' });
    let poll = null;
    let deadline = null;
    let settled = false;
    const clearTimers = () => {
        if (poll !== null) {
            clearTimeout(poll);
            poll = null;
        }
        if (deadline !== null) {
            clearTimeout(deadline);
            deadline = null;
        }
    };
    const handle = {
        cancel() {
            settled = true;
            clearTimers();
        },
    };
    const pollFn = () => {
        if (settled) {
            return;
        }
        // The provider statuses the summary last painted: the fast-poll reads the
        // value the last fetch settled, not a stale closure.
        const entry = (store.getSnapshot().summary?.providers ?? []).find((p) => p.id === provider.id);
        if (entry !== undefined && entry.status !== 'running') {
            // The provider is no longer running: the stop succeeded.
            move(store, provider.id, { type: 'stopped' });
            settled = true;
            clearTimers();
            return;
        }
        void repriceSummary(store);
        poll = setTimeout(pollFn, STOP_POLL_MS);
    };
    poll = setTimeout(pollFn, STOP_POLL_MS);
    deadline = setTimeout(() => {
        // The provider is still running after the deadline: settle to the red
        // Logs state, the same path a failed launch takes.
        if (settled) {
            return;
        }
        settled = true;
        clearTimers();
        move(store, provider.id, { type: 'stopFailed' });
    }, STOP_HEALTH_DEADLINE_MS);
    void postStop({
        engine: provider.engine,
        config: provider.config,
        platform: { [provider.engine]: provider.platform },
        providerId: provider.id,
    }).catch(() => {
        // A stop that fails leaves the entry in its last state; the fast-poll and
        // the deadline settle it.
    });
    return handle;
}
//# sourceMappingURL=providers.js.map
