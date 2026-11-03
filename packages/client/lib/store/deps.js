/**
 * The deps panel drivers: the copy, allow-run, install, and Get actions the
 * System dependencies panel runs, plus the deps re-price read.
 *
 * Every server mutation rides performAction as a pending -> ack | timeout
 * transition over the store's action cells, the way the template download
 * rides the template cell. The deps re-price is a read (the route re-probes
 * the host on every fetch, so the "Get" gate always reads the live checkDeps
 * answer), so it carries no action cell: it settles the deps model and the
 * deps note. The clipboard copy is client-side only, so it rides the copy
 * note.
 * @module dsh-plugin-local-infer/client/store/deps
 */
import { fetchDeps, fetchSummary, postGet, postInstall, postSave, } from "../api/routes.js";
import { performAction, ACTION_TIMEOUTS } from "./sync.js";
/**
 * GET_IDLE_MS is the Get run's output-idle cap in ms. Two minutes without a
 * streamed line reads as a stalled build: the card settles the get cell (the
 * control re-enables) while the run keeps streaming in the background.
 */
export const GET_IDLE_MS = 120_000;
/**
 * repriceDeps re-fetches the deps panel model (the GET /local-infer/deps
 * route). A fetch failure reads as no panel: a host that predates the deps
 * route keeps the card usable, so the model clears and the panel hides.
 */
export function repriceDeps(store, query) {
    return fetchDeps(query)
        .then((deps) => {
        store.dispatch({ type: 'deps/ack', deps });
    })
        .catch(() => {
        store.dispatch({ type: 'deps/clear' });
    });
}
/**
 * repriceSummary re-fetches the card's read model (the GET
 * /local-infer/summary route). The ack stores the summary and merges its
 * persisted fields into the draft field-level (the reducer's rule), so a
 * provider edit, cancel, or new-provider load re-prices the meter and the
 * provider list from the host's stored config. A fetch failure stores the
 * route's message as the summary note, so the card's load line names it.
 */
export function repriceSummary(store, query) {
    return fetchSummary(query)
        .then((summary) => {
        store.dispatch({ type: 'summary/ack', summary });
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.dispatch({ type: 'summary/fail', note: message });
    });
}
/**
 * copyInstallString hands the install block to the clipboard (client-side
 * only, so it rides the copy note, not an action cell). The note shows the
 * localized copied / copy-failed label for two seconds, then clears. A host
 * without a clipboard (or a write failure) reads as the copy-failed label.
 */
export function copyInstallString(store, t) {
    const deps = store.getSnapshot().deps;
    if (deps === null || deps.installString === '') {
        return;
    }
    const text = deps.installString;
    const done = (ok) => {
        store.dispatch({ type: 'note/set', key: 'copy', note: ok ? t.copied : t.copyFailed });
        setTimeout(() => {
            store.dispatch({ type: 'note/clear', key: 'copy' });
        }, 2000);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        navigator.clipboard
            .writeText(text)
            .then(() => done(true))
            .catch(() => done(false));
    }
    else {
        done(false);
    }
}
/**
 * performAllowRun persists the trust gate through the save route as a
 * settings-only save: the flag keeps the route from upserting a provider
 * entry, so a toggle never mints a duplicate at the top of the list. On the
 * ack it stores the fresh summary and re-prices the deps panel from the
 * persisted config. A failed or timed-out save leaves the stored config
 * untouched, so it re-prices nothing.
 */
export function performAllowRun(store, checked) {
    const state = store.getSnapshot();
    const draft = state.draft;
    if (draft === null) {
        return Promise.resolve();
    }
    return performAction(store, 'save', () => postSave({
        engine: draft.engine,
        config: draft.config,
        allowRunDeps: checked,
        platform: draft.platform ?? {},
        showHelp: state.ui.help,
        settingsOnly: true,
    }).then((summary) => {
        store.dispatch({ type: 'summary/ack', summary });
        return 'ok';
    }), ACTION_TIMEOUTS.save).then(() => {
        if (store.getSnapshot().actions.save.status === 'ok') {
            return repriceDeps(store);
        }
    });
}
/**
 * performInstall runs the Play/Run path through the install route. The
 * response carries the re-checked deps model, so the panel re-renders the
 * gate from the same re-check the install ran: a passed re-check reads as
 * the satisfied note, a failed one names the unsatisfied deps. A route
 * refusal (the trust gate off) settles the install cell to error with the
 * route's own message, which the panel renders as the deps note.
 */
export function performInstall(store, t) {
    const state = store.getSnapshot();
    const draft = state.draft;
    if (state.deps === null || draft === null) {
        return Promise.resolve();
    }
    return performAction(store, 'install', () => postInstall({ engine: draft.engine, config: draft.config }).then((body) => {
        // The acked model clears the deps note, so the result note lands
        // after it.
        store.dispatch({ type: 'deps/ack', deps: body.deps });
        if (body.result.ok) {
            store.dispatch({ type: 'note/set', key: 'deps', note: t.depsSatisfied });
            return 'ok';
        }
        const failed = (body.result.results ?? []).filter((entry) => entry.status !== 'satisfied');
        store.dispatch({
            type: 'note/set',
            key: 'deps',
            note: failed
                .map((entry) => entry.id + (entry.detail ? ': ' + entry.detail : ''))
                .join('; '),
        });
        return 'ok';
    }), ACTION_TIMEOUTS.install);
}
/**
 * performGet runs the git sync, the dependency plan, and the build through
 * the get route's text stream. The click seeds the Logs section's streamed
 * buffer from the persisted last-run logs with a "Getting..." separator, so
 * the run reads as a fresh Logs section. Each chunk appends to the buffer
 * and re-arms the idle cap: two minutes without a line settles the get cell
 * (the control re-enables) while the run keeps streaming in the background.
 * When the stream ends, the route has persisted the run as the last logs,
 * so a summary re-read hands the Logs section back to the stored value.
 */
export function performGet(store, t) {
    const state = store.getSnapshot();
    const draft = state.draft;
    if (state.deps === null || draft === null) {
        return Promise.resolve();
    }
    const platform = (draft.platform ?? {})[draft.engine];
    const base = state.ui.logs.getLogs ?? state.summary?.lastLogs ?? '';
    store.dispatch({
        type: 'ui/patch',
        patch: {
            logs: {
                ...state.ui.logs,
                getLogs: base + (base === '' ? '' : '\n') + '--- ' + t.getting + '\n',
            },
        },
    });
    const append = (chunk) => {
        const logs = store.getSnapshot().ui.logs;
        store.dispatch({
            type: 'ui/patch',
            patch: { logs: { ...logs, getLogs: (logs.getLogs ?? '') + chunk } },
        });
    };
    let idleTimer = null;
    let finished = false;
    let resolveDetail = () => { };
    // finish settles the run's side effects (the idle timer, the summary
    // re-read) once, whichever path lands first.
    const finish = (reprice) => {
        if (finished) {
            return;
        }
        finished = true;
        if (idleTimer !== null) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
        if (reprice) {
            // The route persisted the run as the last logs; the summary re-read
            // hands the Logs section back to the stored value.
            fetchSummary({ engine: draft.engine, config: draft.config })
                .then((summary) => store.dispatch({ type: 'summary/ack', summary }))
                .catch(() => store.dispatch({ type: 'summary/fail', note: '' }));
        }
    };
    const armIdle = () => {
        if (finished) {
            return;
        }
        if (idleTimer !== null) {
            clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
            finish(false);
            resolveDetail('idle');
        }, GET_IDLE_MS);
    };
    // The idle cap arms before performAction's deadline, so at the shared 120 s
    // cap the idle settle (the control re-enables, the run keeps streaming)
    // fires first and the deadline's timeout reads as a no-op.
    armIdle();
    return performAction(store, 'get', () => new Promise((resolve, reject) => {
        resolveDetail = resolve;
        postGet({
            engine: draft.engine,
            config: draft.config,
            ...(platform !== undefined ? { platform } : {}),
        }, (chunk) => {
            append(chunk);
            armIdle();
        })
            .then(() => {
            finish(true);
            resolve('ok');
        })
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            append('\n' + t.getFailed + ': ' + message + '\n');
            finish(true);
            reject(new Error(message));
        });
    }), ACTION_TIMEOUTS.get);
}
//# sourceMappingURL=deps.js.map
