/**
 * The getProgress throttle the performGet run drives: it patches the
 * ui.getProgress readout at a bounded cadence, so a burst of streamed tqdm
 * states (the get route's log and progress events) lands at most ~2 store
 * patches per second. A { progress } event (the server-parsed state) wins
 * over a text-parsed one, and settle lands the latest state before clearing
 * the readout, so it never outlives the run.
 * @module dsh-plugin-local-infer/client/store/progress-throttle
 */
import type { GetProgressState } from './progress.ts';
import type { CardStore } from './sync.ts';
/**
 * ProgressThrottle patches ui.getProgress at a minimum interval (the
 * performGet run's ~2 Hz cadence). A state that lands inside the interval
 * arms one timer for the interval's end, so a burst of updates patches at
 * most once per interval. A server-parsed state (a { progress } event) wins
 * over a text-parsed one: a text state that lands after the first
 * structured state is dropped. flush lands the latest state now, and
 * settle flushes, then clears the readout back to null.
 */
export declare class ProgressThrottle {
    private readonly store;
    private readonly intervalMs;
    private latestState;
    private structured;
    private lastPatch;
    private timer;
    constructor(store: CardStore, intervalMs: number);
    get latest(): GetProgressState | null;
    note(state: GetProgressState, structured: boolean): void;
    flush(): void;
    settle(): void;
}
//# sourceMappingURL=progress-throttle.d.ts.map
