/**
 * The card's action sync layer: performAction drives one server mutation
 * as a pending -> ack | timeout transition over the store, and
 * ACTION_TIMEOUTS prices the per-action deadline.
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
 * ACTION_TIMEOUTS is the per-action deadline table in ms. launch arms
 * the route's health-poll cap, stop is the fast-poll cap, get,
 * download, and install run the long host-side work, and the rest
 * settle within 30 s.
 */
export declare const ACTION_TIMEOUTS: Record<ActionKey, number>;
/**
 * performAction runs one card server mutation as a pending -> ack |
 * timeout transition. It dispatches action/start, awaits run(), and
 * settles the cell with action/ack (the resolved detail) or action/fail
 * (the rejection message); the deadline timer dispatches action/timeout
 * and clears on settle. A second call for the same key while the first
 * is pending returns without dispatching: the in-flight round trip owns
 * the cell. The returned promise resolves when the cell settles (ack,
 * fail, or timeout) and never rejects: the store cell is the source of
 * truth for the result.
 */
export declare function performAction(store: CardStore, key: ActionKey, run: () => Promise<string>, timeoutMs: number): Promise<void>;
//# sourceMappingURL=sync.d.ts.map
