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
import { cancelInFlightRuns, forgetGetAbort, hasInFlightGet, trackGetAbort, } from "./abort.js";
import { ProgressThrottle } from "./progress-throttle.js";
import { parseHfProgress } from "./progress.js";
import { appendCanceledLog, appendLogChunk, seedProcessLog } from "./logs.js";
import { performAction, ACTION_TIMEOUTS } from "./sync.js";
/**
 * GET_IDLE_MS is the Get run's output-idle cap in ms. Two minutes without a
 * streamed line reads as a stalled build: the card settles the get cell (the
 * control re-enables) while the run keeps streaming in the background.
 */
export const GET_IDLE_MS = 120_000;
/**
 * GET_PROGRESS_THROTTLE_MS is the minimum interval in ms between
 * getProgress store patches: the card folds the streamed tqdm state at
 * ~2 Hz. The latest state always lands on the final chunk and when the run
 * settles (the throttle's pending flush).
 */
export const GET_PROGRESS_THROTTLE_MS = 500;
/**
 * COPY_NOTE_MS is how long the clipboard copy's note (the copied /
 * copy-failed label) stays visible before it clears.
 */
const COPY_NOTE_MS = 2_000;
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
 * repriceAll re-fetches both read models the card prices from the host's
 * stored config: the summary (the meter, the provider list, the status dots)
 * and the deps panel. The pair always re-prices together with the same query,
 * so the drivers call this one helper instead of the two fetches. The fetches
 * are fire-and-forget (the drivers do not await them), so the returned
 * promise settles immediately.
 */
export function repriceAll(store, query) {
    void repriceSummary(store, query);
    void repriceDeps(store, query);
    return Promise.resolve();
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
        }, COPY_NOTE_MS);
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
 * the get route's NDJSON stream. The click seeds the Logs section's streamed
 * buffer from the persisted last-run logs with a "Getting engine and
 * model..." separator, so the run reads as a fresh Logs section. Each log
 * event appends to the buffer and re-arms the idle cap: two minutes without a
 * line settles the get cell (the control re-enables) while the run keeps
 * streaming in the background. The run folds the streamed tqdm state into
 * the ui.getProgress readout through the ProgressThrottle (the 500 ms
 * cadence): a { progress } event (the server-parsed state) wins over the
 * text parse of a log chunk, and the field clears when the run settles
 * (success, failure, or abort), so the readout never outlives the run. When
 * the stream ends, the route has
 * persisted the run as the last logs, so a summary re-read hands the Logs
 * section back to the stored value. The run registers its AbortController in the in-flight
 * registry, so the provider form's Cancel closes the stream and the route
 * interrupts the in-flight hf child; an aborted run settles without a
 * failure line (the "Canceled" line the Cancel wrote is the run's tail). A
 * second click while a run is in flight (a long download that outlived the
 * idle cap and settled the cell) is a no-op, so it never starts a concurrent
 * run: the in-flight download keeps streaming, and a restart needs a Cancel
 * first.
 */
export function performGet(store, t) {
    const state = store.getSnapshot();
    const draft = state.draft;
    if (state.deps === null || draft === null) {
        return Promise.resolve();
    }
    // A Get already in flight keeps streaming in the background (a long download
    // that outlived the idle cap and settled the cell to ok). A second click must
    // not start a concurrent run, so it is a no-op; cancel the in-flight run
    // first to restart.
    if (hasInFlightGet()) {
        return Promise.resolve();
    }
    const platform = (draft.platform ?? {})[draft.engine];
    seedProcessLog(store, t.getting);
    // The readout throttle: a { progress } event (the server-parsed state)
    // wins over the text parse of a log chunk, and settle lands the latest
    // state before clearing the field, so the readout never outlives the run.
    const throttle = new ProgressThrottle(store, GET_PROGRESS_THROTTLE_MS);
    const append = (chunk) => {
        appendLogChunk(store, chunk);
        // The text parse is the fallback for hosts that stream log text without
        // progress events: fold the chunk into the latest state, and note the
        // state only when the chunk carries a bar update (the fold returns the
        // prior state unchanged otherwise).
        const parsed = parseHfProgress(chunk, throttle.latest);
        if (parsed !== null && parsed !== throttle.latest) {
            throttle.note(parsed, false);
        }
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
    // The run's abort: the provider form's Cancel closes the stream through it,
    // and the route's response close interrupts the in-flight hf child.
    const controller = new AbortController();
    trackGetAbort(controller);
    // settleRun lands the run's side effects (the abort registry entry, the
    // progress settle, the summary re-read) once, whichever settle path lands
    // first.
    const settleRun = () => {
        forgetGetAbort(controller);
        throttle.settle();
        finish(true);
    };
    return performAction(store, 'get', () => new Promise((resolve, reject) => {
        resolveDetail = resolve;
        postGet({
            engine: draft.engine,
            config: draft.config,
            ...(platform !== undefined ? { platform } : {}),
        }, (chunk) => {
            append(chunk);
            armIdle();
        }, controller.signal, (progress) => {
            // The structured event is the server-parsed state: it wins over
            // the text parse when both arrive.
            throttle.note(progress, true);
        })
            .then(() => {
            settleRun();
            resolve('ok');
        })
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            // An aborted run (the provider form's Cancel) reads as canceled,
            // not failed: the "Canceled" line the Cancel wrote is the tail,
            // so no failure line appends.
            if (controller.signal.aborted !== true) {
                append('\n' + t.getFailed + ': ' + message + '\n');
            }
            settleRun();
            reject(new Error(message));
        });
    }), ACTION_TIMEOUTS.get);
}
/**
 * performGetCancel cancels the in-flight Get run without collapsing the
 * provider form. It aborts the tracked run through cancelInFlightRuns (the
 * service's downloadRunner watchChildAbort then sends SIGINT to the hf
 * child, escalating to SIGTERM after the grace window), appends the
 * "Canceled" line to the Logs buffer when a run was aborted, and clears the
 * getProgress readout back to null. The form stays open (the draft and the
 * form mode are untouched, unlike cancelProvider). The aborted run settles
 * the get cell to error through performGet's settle path, so the 'getting'
 * control branch and the step chips stop firing. The cancel affordances
 * (the title bar, the deps panel, and the Logs header) call it.
 */
export function performGetCancel(store) {
    const aborted = cancelInFlightRuns();
    if (aborted) {
        appendCanceledLog(store);
    }
    store.dispatch({ type: 'ui/patch', patch: { getProgress: null } });
}
//# sourceMappingURL=deps.js.map
