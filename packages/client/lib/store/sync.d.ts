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
import type { ActionKey, CardAction, CardState } from './types.ts';
/**
 * CardStore is the minimal store surface performAction drives: dispatch
 * one CardAction and read the current snapshot (the pending guard reads
 * it). The per-mount store T2.5 builds ({ state, dispatch, subscribe,
 * getSnapshot }) satisfies it structurally.
 */
export interface CardStore {
    dispatch(action: CardAction): void;
    getSnapshot(): CardState;
}
/**
 * NO_FIXED_DEADLINE is the ACTION_TIMEOUTS value meaning "arm no timer":
 * the caller's own settle owns the deadline. The get cell runs an
 * arbitrarily long streamed host run whose progress events keep the cell
 * alive (the idle cap in deps.ts is the progress-aware deadline), so any
 * fixed value here would race an actively streaming run at the shared cap.
 */
export declare const NO_FIXED_DEADLINE = 0;
/**
 * ACTION_TIMEOUTS is the per-action deadline table in ms. launch arms
 * the route's health-poll cap, stop is the fast-poll cap, download and
 * install run the long host-side work, the rest settle within 30 s, and
 * get arms no fixed timer: its progress-aware idle cap owns the settle.
 */
export declare const ACTION_TIMEOUTS: Record<ActionKey, number>;
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
export declare function performAction(store: CardStore, key: ActionKey, run: () => Promise<string>, timeoutMs: number): Promise<void>;
/**
 * TEMPLATE_DOWNLOAD_TIMEOUT is the chat-template download deadline in ms:
 * the hf CLI pull runs the long host-side work, the same cap the model
 * download arms.
 */
export declare const TEMPLATE_DOWNLOAD_TIMEOUT = 120000;
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
export declare function performTemplateAction(store: CardStore, run: () => Promise<string>, timeoutMs: number): Promise<void>;
//# sourceMappingURL=sync.d.ts.map
