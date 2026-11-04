/**
 * The NDJSON stream helpers the get and launch routes share: the one-line
 * writer, the throttled progress sink the routes hand the hf download's
 * onChunk callback to, and the abort controller that watches the response
 * for the card's Cancel. The helpers keep the two routes' stream wiring
 * identical, so a change to the throttle cadence, the event line format, or
 * the cancel rule lands in one place.
 * @module dsh-plugin-local-infer/ui/routes/stream
 */
import type { HfProgress } from 'dsh-plugin-local-infer/core';
import type { RouteResponder } from '../route.ts';
export declare const PROGRESS_MIN_INTERVAL_MS = 500;
/**
 * ndjsonLine writes one NDJSON event line to the stream: the JSON-encoded
 * event plus a newline, through the responder's chunk writer (a fake
 * response without write() collects nothing).
 */
export declare function ndjsonLine(res: RouteResponder, line: unknown): void;
/**
 * throttledProgressSink builds the onChunk callback a stream route hands the
 * hf download's progress sink to: the core chunk folder turns the tqdm lines
 * into a structured state, and the sink emits the state at most once per
 * PROGRESS_MIN_INTERVAL_MS, so a hot tqdm cadence never floods the stream.
 * The first parseable state emits immediately (the last-emit timestamp
 * starts at 0).
 */
export declare function throttledProgressSink(write: (progress: HfProgress) => void): (chunk: string) => void;
/**
 * abortOnResponseClose wires the card's cancel to the response: a client
 * disconnect (the response's close before the route ends) aborts the
 * returned controller, and markFinished settles the run so a close after
 * the route ended reads as the normal end, not a cancel. A fake response
 * without on() never fires the close, and the run degrades to running to
 * completion.
 */
export declare function abortOnResponseClose(res: RouteResponder): {
    signal: AbortSignal;
    markFinished(): void;
};
//# sourceMappingURL=stream.d.ts.map
