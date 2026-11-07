/**
 * The live run-log stream: the store module that holds the card's single
 * attached GET /local-infer/logs connection (Q2: all live log display
 * streams, nothing polls). attachRunLogStream opens the connection for one
 * run key and feeds the Logs buffer: the catch-up snapshot replaces it, a
 * runBegin replaces it with the new run's seed, a log appends, and a runEnd
 * ends the key's in-flight marker. The pane follows one target at a time
 * (Q3: the edited provider, else the latest started run), so beginRun,
 * endRun, setLogsPaneMounted, and retargetRunLogs all route the single
 * attach through attachRunLogStream: a target switch detaches the old key
 * before the new one attaches. A stream that breaks while the client still
 * believes a run is in flight reconnects once after the backoff (the fresh
 * snapshot catch-up covers the gap); a break after the run settled ends
 * quietly with the buffer kept. A mount-time attach whose snapshot answers
 * running=false while nothing runs locally (the page-refresh catch-up read)
 * detaches right away and remembers the probe, so a re-render does not
 * re-open an idle key until a run starts there. clientRunLogKey mirrors the
 * host's runLogKey rule so the client names the buffer its own request
 * writes.
 * @module dsh-plugin-local-infer/client/store/logs-stream
 */
import type { Config } from 'dsh-plugin-local-infer/ui';
import type { CardStore } from './sync.ts';
/**
 * RECONNECT_BACKOFF_MS is the wait before a broken stream's single retry: a
 * host mid-restart answers the retry instead of a hammer, and the retry's
 * snapshot catch-up covers whatever the gap missed.
 */
export declare const RECONNECT_BACKOFF_MS = 1000;
/**
 * RunLogStreamHandle is one attach's ownership token: detach closes the
 * stream (the abort ends the in-flight body read), and a repeated detach is
 * a no-op.
 */
export interface RunLogStreamHandle {
    detach(): void;
}
/**
 * RunLogKeyEntry is the stored provider shape the run-log key rule matches:
 * the entry id (the key itself when a request names it), the engine, and the
 * config whose model field pairs with the engine. The summary's provider
 * entries satisfy it structurally.
 */
export interface RunLogKeyEntry {
    id: string;
    engine: string;
    config: Config;
}
/**
 * clientRunLogKey names the run-log key a request's output lands under,
 * mirroring the host's runLogKey rule (packages/service/src/run-logs.ts)
 * exactly: the request's providerId when it names one, else the stored entry
 * matched by engine and config model, else the engine id. Both sides read
 * the same request fields, so an unsaved model edit falls to the engine-id
 * key on both sides alike.
 */
export declare function clientRunLogKey(providers: readonly RunLogKeyEntry[], engine: string, config: Config, providerId?: string): string;
/**
 * attachRunLogStream opens the card's one run-log stream for key: an attach
 * already serving the same key is reused (the single-attach invariant), and
 * an attach on another key is detached first. The handle's detach ends the
 * stream and drops every later event on it.
 */
export declare function attachRunLogStream(store: CardStore, key: string): RunLogStreamHandle;
/**
 * beginRun records a driver-started run under key and makes it the pane
 * target (Q3: the latest started run). With the Logs section mounted the
 * stream attaches right away: the snapshot may momentarily show the prior
 * run's text (the driver's request can beat the host's hub begin), and the
 * host's runBegin event replaces it with the new run's seed.
 */
export declare function beginRun(store: CardStore, key: string): void;
/**
 * endRun drops key's in-flight marker when its driver settles and closes a
 * stream still following the run. The pane falls back to the edited
 * provider target (Q3), so endRun only switches to that provider when the
 * form is editing one; otherwise it detaches, and the summary ack hands the
 * pane back to the stored lastLogs.
 */
export declare function endRun(store: CardStore, key: string): void;
/**
 * setLogsPaneMounted records the Logs section's mount from the pane's own
 * effect. Mounting retargets the stream (the page-refresh catch-up: the pane
 * target attaches, and a snapshot answering running=false closes an idle
 * probe right away); unmounting detaches, so a collapsed form never holds
 * an open connection.
 */
export declare function setLogsPaneMounted(store: CardStore, mounted: boolean): void;
/**
 * retargetRunLogs syncs the single attached stream to the pane target (Q3):
 * the edited provider, else the latest locally started run. The card runs it
 * on an editing switch and on a summary ack (the read the page-refresh mount
 * guesses from); a null target detaches, and a target whose idle probe is
 * remembered detaches without re-opening it until a run starts there.
 */
export declare function retargetRunLogs(store: CardStore): void;
/**
 * clearRunLogStreams detaches any attached stream and drops the module's run
 * bookkeeping, so a test starts from an empty slate (the module state
 * outlives a single test).
 */
export declare function clearRunLogStreams(): void;
//# sourceMappingURL=logs-stream.d.ts.map
