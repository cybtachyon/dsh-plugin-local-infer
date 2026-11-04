/**
 * The POST /local-infer/launch route: it renders the plan the registered
 * adapter produces and runs the service's launch entry point (deploy, then
 * the health poll). The launch streams its progress as NDJSON: a step event
 * as each phase (prereqs, download, build, launch) begins, a progress event
 * when the Get-steps hf download's tqdm stderr folds into a structured
 * state, then a final result event. The card's Launch control reads the step
 * that is running and times out only the launch (health-poll) step; the
 * rebuild steps run as long as they need to.
 * @module dsh-plugin-local-infer/ui/routes/launch
 */

import type { HfProgress, LaunchStep, LifecycleHost } from 'dsh-plugin-local-infer/core'
import type { LaunchResult, LocalInferService } from 'dsh-plugin-local-infer/service'
import { foldHfProgressChunk } from '../../../core/lib/index.js'
import { nodeLifecycleHost } from '../../../providers/lib/index.js'
import { launchEngine } from '../ops/engine.ts'
import { defineRoute, RouteError } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { launchRequestFromBody } from '../request.ts'

/**
 * LaunchStreamEvent is one NDJSON line the launch route streams: a step
 * event as a phase begins, a progress event when the Get-steps hf download's
 * tqdm stderr folds into a structured state, or the final result event. The
 * object literal union keeps the card's reader honest: a line is a step, a
 * progress, or a result, and a result is either the full launch result or
 * the broken-launch fallback that names the failure.
 */
type LaunchStreamEvent =
  | { step: LaunchStep }
  | { progress: HfProgress }
  | { result: LaunchResult | { healthy: false; detail: string } }

// The minimum interval between progress events: the tqdm cadence is hot (a
// bar redraw per chunk), so the route emits at most one event per half
// second, the same cadence the get route throttles to.
const PROGRESS_MIN_INTERVAL_MS = 500

/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect. The optional launchHost is the lifecycle
 * host the launch's Get steps (git sync, build) run through; it defaults to
 * the node host, and a test injects a stub so the route never clones a real
 * repo in CI.
 */
export function launchRoute(
  localInfer: LocalInferService,
  launchHost: LifecycleHost = nodeLifecycleHost,
): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-launch',
    path: '/local-infer/launch',
    method: 'POST',
    failStatus: 500,
    tooLargeMessage: 'launch payload too large',
    run: async ({ body }, res) => {
      res.ndjsonStream()
      const writeLine = (line: LaunchStreamEvent): void => {
        res.write(JSON.stringify(line) + '\n')
      }
      const onProgress = (step: LaunchStep): void => {
        writeLine({ step })
      }
      // The Get-steps hf download's raw stderr sink: the core chunk folder
      // turns the tqdm lines into a structured state, and the route emits a
      // progress event when a fold yields one (throttled to the half-second
      // cadence), between the step and result events.
      let folded: HfProgress | undefined
      let lastProgressAt = 0
      const onChunk = (chunk: string): void => {
        const state = foldHfProgressChunk(chunk, folded)
        if (state === undefined) return
        folded = state
        const now = Date.now()
        if (now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
          lastProgressAt = now
          writeLine({ progress: state })
        }
      }
      // The card's provider-form Cancel aborts the fetch, which closes the
      // response: the abort interrupts the in-flight Get-step hf child
      // (SIGINT, then SIGTERM), and the persisted run carries the "Canceled"
      // line. A close after the run settled is the normal end, not a cancel.
      const controller = new AbortController()
      let finished = false
      res.onClose(() => {
        if (!finished) {
          controller.abort()
        }
      })
      try {
        const result = await launchEngine(
          localInfer,
          launchRequestFromBody(body),
          onProgress,
          launchHost,
          controller.signal,
          onChunk,
        )
        writeLine({ result })
      } catch (error) {
        // A launch that breaks before a plan renders (an unknown engine, a
        // hardware probe failure) still settles the card's control to the red
        // Logs state through a result event, not a bare 500.
        const detail =
          error instanceof RouteError
            ? error.message
            : String((error as Error)?.message ?? error)
        writeLine({ result: { healthy: false, detail } })
      }
      finished = true
      res.end()
    },
  })
}
