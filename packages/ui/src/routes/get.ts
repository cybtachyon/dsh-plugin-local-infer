/**
 * The POST /local-infer/get route: the Get step. Its answer streams as
 * NDJSON: a log event per log line the card appends to its Logs section, and
 * a progress event when the hf download's tqdm stderr (the onChunk sink)
 * folds into a structured state. The full run persists as the last-run logs
 * in plain text, so the log file and the Logs section read the run the same
 * way.
 * @module dsh-plugin-local-infer/ui/routes/get
 */

import type { Config, LifecycleHost } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { parseStoredPlatformConfig } from '../config.ts'
import { CANCELED_LINE, getEngine } from '../ops/engine.ts'
import { persistProcessLog } from '../ops/logs.ts'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import type { GetRequest } from '../request.ts'
import { abortOnResponseClose, ndjsonLine, throttledProgressSink } from './stream.ts'

/**
 * getRoute builds the POST /local-infer/get route definition the register
 * step holds by an effect. The optional getHost is the lifecycle host the
 * git and build steps run through; it defaults to the node host, and a test
 * injects a stub so the route never clones a real repo in CI.
 */
export function getRoute(
  localInfer: LocalInferService,
  getHost?: LifecycleHost,
): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-get',
    path: '/local-infer/get',
    method: 'POST',
    failStatus: 400,
    tooLargeMessage: 'get payload too large',
    run: async ({ body }, res) => {
      const request: GetRequest = {}
      if (typeof body.engine === 'string') {
        request.engine = body.engine
      }
      if (body.config && typeof body.config === 'object') {
        request.config = body.config as Config
      }
      const platform = parseStoredPlatformConfig(body.platform)
      if (platform !== undefined) {
        request.platform = platform
      }
      res.ndjsonStream()
      let collected = ''
      // The log sink collects the plain-text run (the persisted log) and
      // streams it as NDJSON log events, one event per chunk.
      const log = (text: string): void => {
        collected += text
        ndjsonLine(res, { log: text })
      }
      // The hf download's raw stderr sink: the core chunk folder turns the
      // tqdm lines into a structured state, and the sink emits a progress
      // event when a fold yields one (throttled to the half-second cadence).
      const onChunk = throttledProgressSink((progress) => ndjsonLine(res, { progress }))
      // The card's provider-form Cancel aborts the fetch, which closes the
      // response: the abort interrupts the in-flight hf child (SIGINT, then
      // SIGTERM). Resume is within-invocation only; a killed run re-downloads
      // from zero on the re-run (the orphaned .incomplete blob lingers until
      // `hf cache prune`). A close after the run settled is the normal end,
      // not a cancel.
      const { signal, markFinished } = abortOnResponseClose(res)
      try {
        await getEngine(localInfer, request, log, getHost, signal, onChunk)
      } catch (error) {
        log(`!! get failed: ${String((error as Error)?.message ?? error)}\n`)
      }
      // A cancel that closed the stream appends the "Canceled" line, so the
      // persisted run (and the log file) read the run as canceled, the same
      // line the card writes to its Logs buffer on the Cancel.
      if (signal.aborted) {
        log(`${CANCELED_LINE}`)
      }
      markFinished()
      // The "Getting engine and model..." separator leads the persisted run,
      // so the Logs section and the log file read the run as a fresh process
      // section, the same line the card writes when the Get button is
      // clicked.
      persistProcessLog(`--- Getting engine and model...\n${collected}`)
      res.end()
    },
  })
}
