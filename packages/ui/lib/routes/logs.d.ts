/**
 * The GET /local-infer/logs route: the per-provider live run-log stream the
 * card's Logs pane holds open (Q2: all live log display streams, nothing
 * polls). The handler subscribes to the run-log hub before reading the
 * catch-up snapshot, so an append that lands between the two is deduped by
 * seq against the snapshot instead of doubling or being lost. One attached
 * connection sees, in order: one `{ snapshot, seq, running }` catch-up line,
 * then one `{ log, seq }` line per append, a `{ runBegin, seq }` line when a
 * new run resets the buffer (the pane replaces, never appends), and a
 * `{ runEnd, seq }` line when the run settles. The connection stays attached
 * across runs. An unknown or blank provider key streams the empty snapshot
 * and stays attached, so a client racing a run start never sees a 404; the
 * client disconnect disposes the hub subscription.
 * @module dsh-plugin-local-infer/ui/routes/logs
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * LogsStreamEvent is one NDJSON line the logs route streams: the catch-up
 * snapshot (the bounded buffer text, the seq it reached, the running flag),
 * one appended chunk, a run begin (the new run's seed line, seq back at 0,
 * so the pane replaces its display), or the run end (the seq it settled at).
 * Every line carries the seq the next append continues, so the card can drop
 * any line whose seq the text it holds already covers.
 */
export type LogsStreamEvent = {
    snapshot: string;
    seq: number;
    running: boolean;
} | {
    log: string;
    seq: number;
} | {
    runBegin: string;
    seq: number;
} | {
    runEnd: true;
    seq: number;
};
/**
 * LogsStreamRoute is the logs route's definition plus the open-stream
 * registry the route effect's disposer drains. A bundle switch off
 * unregisters the route, but browser panes that still hold a stream open
 * leave their hub subscriptions behind unless something closes them; the
 * effect disposer calls closeOpenStreams for that.
 */
export interface LogsStreamRoute extends LocalInferRoute {
    closeOpenStreams(): void;
}
/**
 * logsRoute builds the GET /local-infer/logs?provider=<key> route definition
 * the register step holds by an effect. The `provider` query is the run key
 * every run path shares (the runLogKey rule the card's requests mirror); a
 * missing or unknown key is a live stream of nothing until someone runs it.
 */
export declare function logsRoute(localInfer: LocalInferService): LogsStreamRoute;
//# sourceMappingURL=logs.d.ts.map
