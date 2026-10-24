/**
 * The GET /local-infer/summary route: the card's read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the summary the
 * card renders.
 * @module dsh-plugin-local-infer/ui/routes/summary
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { LocalInferRoute } from '../route.ts'
import {
  buildSummary,
  depsRequestFromUrl,
  requireMethod,
  RouteError,
  sendJson,
} from '../route.ts'

/**
 * summaryRoute builds the GET /local-infer/summary route definition the
 * register step holds by an effect.
 */
export function summaryRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-config',
    kind: 'exact',
    path: '/local-infer/summary',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      try {
        const url = new URL(req.url, 'http://localhost')
        sendJson(res, 200, await buildSummary(localInfer, depsRequestFromUrl(url)))
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
