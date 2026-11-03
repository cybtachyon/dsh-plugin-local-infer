/**
 * The pure reducer for the whole CardAction union: the only mutator of
 * CardState. Every server round trip is a pending -> ack | timeout transition
 * (the action and template cells settle only while they are still pending, so
 * a late ack after the deadline is a no-op), the draft is the only source for
 * form field values (a summary ack merges its persisted fields into the draft
 * field-level, and a discard resets it from the summary), and the per-provider
 * launch machine is the only source for lifecycle state (launch/move delegates
 * to launchNextState and stamps the startTime the deadline timers price).
 * @module dsh-plugin-local-infer/client/store/reducer
 */
import type { CardAction, CardState } from './types.ts';
/**
 * ACTION_TIMEOUT_DETAIL is the detail a deadline timer stamps when an action
 * (or the template download) is still pending at the cap. The component maps
 * it to the localized "timed out" label; the reducer itself stays locale-
 * agnostic.
 */
export declare const ACTION_TIMEOUT_DETAIL = "timeout";
/**
 * cardReducer reduces one CardAction over a CardState and returns the next
 * state. It is pure: no clock read leaks into the summary, draft, note, or ui
 * paths, and the only Date.now() in the file is the launch/move startTime
 * stamp the deadline timers arm off. An action it has not named yet leaves the
 * state untouched, so a late or unknown event never corrupts it.
 */
export declare function cardReducer(state: CardState, action: CardAction): CardState;
//# sourceMappingURL=reducer.d.ts.map
