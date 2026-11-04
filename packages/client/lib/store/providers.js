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
import { postLaunch, postProviderDelete, postStop, } from "../api/routes.js";
import { LAUNCH_HEALTH_DEADLINE_MS, STOP_HEALTH_DEADLINE_MS, STOP_POLL_MS, } from "../machine/launch.js";
import { cancelInFlightRuns, forgetLaunchAbort, trackLaunchAbort, } from "./abort.js";
import { repriceAll, repriceSummary } from "./deps.js";
import { appendCanceledLog, appendProcessLog, separatorLine, seedProcessLog, } from "./logs.js";
import { ACTION_TIMEOUTS, performAction } from "./sync.js";
// noHandle is the handle a guarded-out action returns: nothing to cancel.
const noHandle = { cancel() { } };
// move dispatches one launch/move event for the provider, the single path the
// entry's machine is driven through.
function move(store, providerId, event) {
    store.dispatch({ type: 'launch/move', providerId, event });
}
// formModeForProviderCount picks the form mode after a provider list change:
// entries remain reads as the collapsed list, an empty list reads as the
// new-provider form.
function formModeForProviderCount(count) {
    return count > 0 ? 'collapsed' : 'new';
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
    void repriceAll(store, { engine: provider.engine, config: provider.config });
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
 * the log file.
 */
export function cancelProvider(store, providerId) {
    if (cancelInFlightRuns(providerId)) {
        appendCanceledLog(store);
    }
    const state = store.getSnapshot();
    store.dispatch({
        type: 'ui/patch',
        patch: {
            editingProviderId: null,
            providerFormMode: formModeForProviderCount(state.summary?.providers.length ?? 0),
        },
    });
    store.dispatch({ type: 'draft/discard' });
    void repriceAll(store);
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
    void repriceAll(store, { engine: next.engine, config: next.config });
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
                    providerFormMode: formModeForProviderCount(summary.providers.length),
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
 * a red Logs). A result re-fetches the summary and deps read models, so the
 * provider's status dot repaints from red to green and the deps panel
 * re-prices.
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
    // The run's abort: the provider form's Cancel closes the stream through it,
    // and the route's response close interrupts the in-flight Get-step hf child
    // on the host. The unmount cancel clears the timers only, so the run keeps
    // streaming in the background, the same rule the stop driver applies.
    const controller = new AbortController();
    trackLaunchAbort(provider.id, controller);
    // settle marks the run settled and clears its deadline timer and the abort
    // registry entry once, whichever settle path lands first (the unmount
    // cancel, the result, the stream break). It reports whether it was the
    // first settle, so the late paths no-op.
    const settle = () => {
        if (settled) {
            return false;
        }
        settled = true;
        clearDeadline();
        forgetLaunchAbort(provider.id);
        return true;
    };
    const handle = {
        cancel() {
            settle();
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
            appendProcessLog(store, separatorLine(t.entryBuilding));
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
    }, onStep, controller.signal)
        .then((result) => {
        if (settle() !== true) {
            return;
        }
        if (result === null) {
            // The stream ended without a result event: settle to failed.
            move(store, provider.id, { type: 'failed' });
        }
        else if (result.healthy === true) {
            move(store, provider.id, { type: 'healthy' });
        }
        else if (result.state === 'downloading') {
            move(store, provider.id, { type: 'downloading' });
        }
        else {
            move(store, provider.id, { type: 'failed' });
        }
        // The provider status dots price the process probe on a summary fetch,
        // so a launch that turned an engine healthy re-fetches the summary and
        // deps read models to repaint the dot and re-price the deps panel.
        void repriceAll(store, { engine: provider.engine, config: provider.config });
    })
        .catch(() => {
        if (settle() !== true) {
            return;
        }
        // An aborted run (the provider form's Cancel) reads as failed, not a
        // stream break: the "Canceled" line the Cancel wrote is the run's tail,
        // and the red Logs control re-opens the entry for a re-launch.
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
        // Summary only: stopping an engine does not change the deps the panel prices.
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
// draftLaunchBody builds the launch/stop body the draft-based control sends:
// the draft's engine, config, and the per-engine platform entry (the unsaved
// Engine Directory / Fork edits), the Auto Rebuild flag, and the provider id
// the form is editing (the route persists the launch record on that entry).
function draftLaunchBody(store) {
    const state = store.getSnapshot();
    const draft = state.draft;
    const platform = draft !== null ? (draft.platform ?? {})[draft.engine] : undefined;
    const body = {
        autoRebuild: state.ui.autoRebuild,
    };
    if (draft !== null) {
        body.engine = draft.engine;
        body.config = draft.config;
    }
    if (platform !== undefined && draft !== null) {
        body.platform = { [draft.engine]: platform };
    }
    if (state.ui.editingProviderId !== null) {
        body.providerId = state.ui.editingProviderId;
    }
    return body;
}
/**
 * performDraftLaunch runs the form's own Launch control (the title-bar
 * control's draft target): it reads the launch stream (keeping only the result
 * event, the form's control shows no phase labels) and settles the draft's
 * launch cell. A healthy result reads as running (the control becomes Stop),
 * a not-healthy or missing result reads as the launch-failed note. The
 * summary and deps read models re-fetch so the provider's status dot repaints
 * and the deps panel re-prices. The run registers
 * its AbortController under the form's provider id (the "draft" key when the
 * form is not a provider), so the provider form's Cancel closes the stream
 * and the route interrupts the in-flight Get-step hf child on the host.
 */
export function performDraftLaunch(store, t) {
    const state = store.getSnapshot();
    if (state.draft === null) {
        return Promise.resolve();
    }
    const draft = state.draft;
    const abortKey = state.ui.editingProviderId ?? 'draft';
    const controller = new AbortController();
    trackLaunchAbort(abortKey, controller);
    return performAction(store, 'launch', () => postLaunch(draftLaunchBody(store), undefined, controller.signal)
        .then((result) => {
        if (result !== null && result.healthy === true) {
            void repriceAll(store, { engine: draft.engine, config: draft.config });
            return t.runningOn + ' ' + (result.plan !== undefined ? String(result.plan.port) : '');
        }
        if (result !== null) {
            throw new Error(t.notHealthy + (result.detail ? ': ' + result.detail : ''));
        }
        throw new Error(t.launchFailed);
    })
        .catch((error) => {
        // The run settled (a healthy ack throws nothing, a broken stream or
        // the provider form's Cancel rejects): the controller is no longer
        // in flight, so a later Cancel reads it as nothing to abort.
        forgetLaunchAbort(abortKey);
        throw error;
    }), ACTION_TIMEOUTS.launch);
}
/**
 * performDraftStop runs the form's own Stop control (the title-bar control's
 * draft target): it signals the tracked process through the stop route and
 * settles the draft's stop cell. A successful stop reads as stopped (the
 * control becomes Launch). The summary and deps read models re-fetch so the
 * provider's status dot repaints and the deps panel re-prices.
 */
export function performDraftStop(store, t) {
    const state = store.getSnapshot();
    if (state.draft === null) {
        return Promise.resolve();
    }
    const draft = state.draft;
    return performAction(store, 'stop', () => postStop(draftLaunchBody(store)).then(() => {
        void repriceAll(store, { engine: draft.engine, config: draft.config });
        return t.stopped;
    }), ACTION_TIMEOUTS.stop);
}
//# sourceMappingURL=providers.js.map
