/**
 * The card's action sync layer: performAction drives one server mutation
 * as a pending -> ack | timeout transition over the store,
 * performTemplateAction drives the chat-template download over the
 * template cell the same way, and ACTION_TIMEOUTS (plus
 * TEMPLATE_DOWNLOAD_TIMEOUT) price the per-action deadlines.
 *
 * performAction is the only path a card server mutation takes. It
 * dispatches action/start, runs the caller's round trip, and settles the
 * action cell with action/ack (the resolved detail), action/fail (the
 * rejection message), or action/timeout (the deadline). The deadline
 * timer arms at start and clears on settle, so a late ack after the
 * timeout is a no-op: the reducer settles the cell only while it is
 * pending, and the settled flag here keeps the ack and the timer from
 * double-settling. A second performAction for the same key while the
 * first is in flight returns without dispatching, so a double-click
 * never double-starts the round trip.
 * @module dsh-plugin-local-infer/client/store/sync
 */
/**
 * NO_FIXED_DEADLINE is the ACTION_TIMEOUTS value meaning "arm no timer":
 * the caller's own settle owns the deadline. The get cell runs an
 * arbitrarily long streamed host run whose progress events keep the cell
 * alive (the idle cap in deps.ts is the progress-aware deadline), so any
 * fixed value here would race an actively streaming run at the shared cap.
 */
export const NO_FIXED_DEADLINE = 0;
/**
 * ACTION_TIMEOUTS is the per-action deadline table in ms. launch arms
 * the route's health-poll cap, stop is the fast-poll cap, download and
 * install run the long host-side work, the rest settle within 30 s, and
 * get arms no fixed timer: its progress-aware idle cap owns the settle.
 */
export const ACTION_TIMEOUTS = {
    save: 30_000,
    install: 120_000,
    register: 30_000,
    unregister: 30_000,
    launch: 150_000,
    stop: 10_000,
    get: NO_FIXED_DEADLINE,
    download: 120_000,
};
/**
 * performAction runs one card server mutation as a pending -> ack |
 * timeout transition. It dispatches action/start, awaits run(), and
 * settles the cell with action/ack (the resolved detail) or action/fail
 * (the rejection message); the deadline timer dispatches action/timeout
 * and clears on settle. A timeoutMs of NO_FIXED_DEADLINE arms no timer:
 * the run owns its own settle. A second call for the same key while the
 * first is pending returns without dispatching: the in-flight round trip
 * owns the cell. The returned promise resolves when the cell settles
 * (ack, fail, or timeout) and never rejects: the store cell is the source
 * of truth for the result.
 */
export function performAction(store, key, run, timeoutMs) {
    // The in-flight round trip owns the cell: a second start would
    // double-settle it, so skip it.
    if (store.getSnapshot().actions[key].status === 'pending') {
        return Promise.resolve();
    }
    store.dispatch({ type: 'action/start', key });
    let settled = false;
    const timer = timeoutMs > NO_FIXED_DEADLINE
        ? setTimeout(() => {
            settled = true;
            store.dispatch({ type: 'action/timeout', key });
        }, timeoutMs)
        : undefined;
    return run()
        .then((detail) => {
        if (settled) {
            return;
        }
        settled = true;
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        store.dispatch({ type: 'action/ack', key, detail });
    })
        .catch((error) => {
        if (settled) {
            return;
        }
        settled = true;
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        store.dispatch({ type: 'action/fail', key, detail: actionFailDetail(error) });
    });
}
/**
 * TEMPLATE_DOWNLOAD_TIMEOUT is the chat-template download deadline in ms:
 * the hf CLI pull runs the long host-side work, the same cap the model
 * download arms.
 */
export const TEMPLATE_DOWNLOAD_TIMEOUT = 120_000;
/**
 * performTemplateAction runs the chat-template download as a pending ->
 * ack | timeout transition over the template cell, the same TCP-style
 * lifecycle performAction gives the action cells. It dispatches
 * template/start, awaits run(), and settles the cell with template/ack
 * (the resolved detail) or template/fail (the rejection message); the
 * deadline timer dispatches template/timeout and clears on settle. A
 * second call while the first is pending returns without dispatching:
 * the in-flight round trip owns the cell. The returned promise resolves
 * when the cell settles and never rejects.
 */
export function performTemplateAction(store, run, timeoutMs) {
    if (store.getSnapshot().templateActions.download.status === 'pending') {
        return Promise.resolve();
    }
    store.dispatch({ type: 'template/start' });
    let settled = false;
    const timer = setTimeout(() => {
        settled = true;
        store.dispatch({ type: 'template/timeout' });
    }, timeoutMs);
    return run()
        .then((detail) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        store.dispatch({ type: 'template/ack', detail });
    })
        .catch((error) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        store.dispatch({ type: 'template/fail', detail: actionFailDetail(error) });
    });
}
// actionFailDetail maps a rejection to the cell's detail: an Error
// carries its message, anything else stringifies.
function actionFailDetail(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=sync.js.map
