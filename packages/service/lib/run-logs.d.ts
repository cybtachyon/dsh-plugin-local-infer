/**
 * The per-key live run-log hub: one bounded buffer per run key with fan-out
 * to subscribers, so every provider process (Get, Launch, Prereqs, Download,
 * Install, Stop) writes its output to one place the streaming web route
 * serves. The LocalInfer facade publishes the five operations (begin,
 * append, read, subscribe, end); runLogKey names the key rule every caller
 * shares.
 * @module dsh-plugin-local-infer/service/run-logs
 */
import type { Config } from 'dsh-plugin-local-infer/core';
import type { LaunchTargetEntry, RunLogListener, RunLogSnapshot } from './types.ts';
/**
 * RunLogStore holds one RunBuffer per run key and fans RunLogEvents out to
 * the key's subscribers. A throwing listener is isolated per notify, so a
 * broken stream connection never blocks a writer or another subscriber.
 */
export declare class RunLogStore {
    private readonly buffers;
    /**
     * begin resets the key's buffer to the seed line, restarts the seq at 0,
     * marks the run running, and notifies subscribers with the reset event so
     * a mid-run attached reader replaces its display instead of appending
     * onto the previous run.
     */
    begin(key: string, seed: string): void;
    /**
     * append grows the key's text (tail-capped to LOG_TAIL_BYTES, the same
     * rule the stored last-run logs use), counts the append, and notifies
     * subscribers with the chunk. A key with no open run opens one lazily
     * without a seed, and an append to a settled run reopens it, so a note
     * that lands after the run (an engine-death line) still streams; the
     * caller that opens a run this way closes it with its own end.
     */
    append(key: string, chunk: string): void;
    /**
     * read answers the key's catch-up snapshot. A key that never ran reads as
     * an empty stopped snapshot.
     */
    read(key: string): RunLogSnapshot;
    /**
     * subscribe registers a listener for the key's events and returns the
     * disposer. Registering the same function twice delivers once (Set
     * semantics); each connection registers its own closure.
     */
    subscribe(key: string, listener: RunLogListener): () => void;
    /**
     * end clears the running flag and emits the end event; the text stays
     * readable until the next begin. A key with no open run is a no-op, so a
     * repeated end never emits a second end event.
     */
    end(key: string): void;
    /**
     * bufferFor reads the key's buffer, starting an empty stopped one for a
     * key that has none.
     */
    private bufferFor;
    /**
     * notify hands one event to each listener of one buffer. It iterates a
     * copy so a disposer running inside a listener cannot disturb the pass,
     * and it swallows listener throws: a broken connection must never fail
     * the writer.
     */
    private notify;
}
/**
 * runLogKey names the run key every run path and the logs route share, so
 * the client can always predict the key for its request: the request's
 * providerId when it names one, else the stored entry findLaunchTarget
 * matches by engine and model, else the engine id.
 */
export declare function runLogKey(providers: readonly LaunchTargetEntry[], engineId: string, providerId: string | undefined, config: Config): string;
//# sourceMappingURL=run-logs.d.ts.map
