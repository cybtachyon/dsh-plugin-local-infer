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
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { LocalInferRoute } from '../route.ts'
import {
  launchEngine,
  launchRequestFromBody,
  readJsonBody,
  requireMethod,
  RouteError,
  sendJson,
} from '../route.ts'

/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect.
 */
export function launchRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-launch',
    kind: 'exact',
    path: '/local-infer/launch',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'launch payload too large')
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' })
        const writeLine = (line: unknown): void => {
          if (typeof res.write === 'function') {
            res.write(JSON.stringify(line) + '\n')
          }
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
      } catch (error) {
        if (error instanceof RouteError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }
}
