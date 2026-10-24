/**
 * The POST /local-infer/launch route: it renders the plan the registered
 * adapter produces and runs the service's launch entry point (deploy, then
 * the health poll). The launch streams its progress as NDJSON: a step event
 * as each phase (prereqs, download, build, launch) begins, then a final
 * result event. The card's Launch control reads the step that is running and
 * times out only the launch (health-poll) step; the rebuild steps run as
 * long as they need to.
 * @module dsh-plugin-local-infer/ui/routes/launch
 */

import type { LaunchStep } from 'dsh-plugin-local-infer/core'
import type { LaunchResult, LocalInferService } from 'dsh-plugin-local-infer/service'
import { launchEngine } from '../ops/engine.ts'
import { defineRoute, RouteError } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { launchRequestFromBody } from '../request.ts'

/**
 * LaunchStreamEvent is one NDJSON line the launch route streams: a step
 * event as a phase begins, or the final result event. The object literal
 * union keeps the card's reader honest: a line is either a step or a result,
 * and a result is either the full launch result or the broken-launch
 * fallback that names the failure.
 */
type LaunchStreamEvent =
  | { step: LaunchStep }
  | { result: LaunchResult | { healthy: false; detail: string } }

/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect.
 */
export function launchRoute(localInfer: LocalInferService): LocalInferRoute {
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
      try {
        const result = await launchEngine(localInfer, launchRequestFromBody(body), onProgress)
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
      res.end()
    },
  })
}
