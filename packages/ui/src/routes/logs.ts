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

import type { LocalInferService, RunLogEvent } from 'dsh-plugin-local-infer/service'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { ndjsonLine } from './stream.ts'

/**
 * LogsStreamEvent is one NDJSON line the logs route streams: the catch-up
 * snapshot (the bounded buffer text, the seq it reached, the running flag),
 * one appended chunk, a run begin (the new run's seed line, seq back at 0,
 * so the pane replaces its display), or the run end (the seq it settled at).
 * Every line carries the seq the next append continues, so the card can drop
 * any line whose seq the text it holds already covers.
 */
export type LogsStreamEvent =
  | { snapshot: string; seq: number; running: boolean }
  | { log: string; seq: number }
  | { runBegin: string; seq: number }
  | { runEnd: true; seq: number }

/**
 * logsRoute builds the GET /local-infer/logs?provider=<key> route definition
 * the register step holds by an effect. The `provider` query is the run key
 * every run path shares (the runLogKey rule the card's requests mirror); a
 * missing or unknown key is a live stream of nothing until someone runs it.
 */
export function logsRoute(localInfer: LocalInferService): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-logs',
    path: '/local-infer/logs',
    method: 'GET',
    failStatus: 500,
    run: async ({ url }, res) => {
      res.ndjsonStream()
      const key = url.searchParams.get('provider') ?? ''
      // The highest hub seq the client's text already covers: the snapshot
      // line, then every forwarded log append. A log event at or below it is
      // already in text the client holds, so it is dropped.
      let coveredSeq = 0
      // True until the snapshot line is on the wire. Hub events that land in
      // the window between subscribe and the snapshot read queue here and
      // then run through the same seq rule, so the snapshot is always the
      // stream's first line.
      let catchingUp = true
      const queued: RunLogEvent[] = []
      // A client disconnect stops forwarding before the hub hands another
      // event to a write on the closed response.
      let closed = false
      const forward = (event: RunLogEvent): void => {
        if (event.kind === 'log') {
          if (event.seq <= coveredSeq) return
          coveredSeq = event.seq
          ndjsonLine(res, { log: event.text, seq: event.seq } satisfies LogsStreamEvent)
          return
        }
        if (event.kind === 'reset') {
          // A new run restarted the key's seq at 0 with the seed line; the
          // pane replaces its buffer, and the seq count restarts with it.
          coveredSeq = event.seq
          ndjsonLine(res, { runBegin: event.text, seq: event.seq } satisfies LogsStreamEvent)
          return
        }
        ndjsonLine(res, { runEnd: true, seq: event.seq } satisfies LogsStreamEvent)
      }
      // Subscribe first, then read: an append racing between the two is
      // caught by the listener (queued) and deduped against the snapshot
      // that already holds its text, never lost or doubled.
      const dispose = localInfer.subscribeRunLog(key, (event) => {
        if (closed) return
        if (catchingUp) {
          queued.push(event)
          return
        }
        forward(event)
      })
      const snapshot = localInfer.readRunLog(key)
      coveredSeq = snapshot.seq
      ndjsonLine(res, {
        snapshot: snapshot.text,
        seq: snapshot.seq,
        running: snapshot.running,
      } satisfies LogsStreamEvent)
      catchingUp = false
      for (const event of queued) {
        forward(event)
      }
      // The card unmounting or refreshing closes the response: dispose the
      // subscription so a gone pane never leaves a listener behind.
      res.onClose(() => {
        closed = true
        dispose()
      })
    },
  })
}
