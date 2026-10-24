/**
 * The POST /local-infer/unregister route: it runs the service's removeModel
 * entry point for the engine's provider and the model row the register step
 * resolved, so the removal targets the exact entry the registration wrote.
 * @module dsh-plugin-local-infer/ui/routes/unregister
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { LocalInferRoute } from '../route.ts'
import {
  readJsonBody,
  registerRequestFromBody,
  requireMethod,
  RouteError,
  sendJson,
  unregisterFor,
} from '../route.ts'

/**
 * unregisterRoute builds the POST /local-infer/unregister route definition
 * the register step holds by an effect.
 */
export function unregisterRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-unregister',
    kind: 'exact',
    path: '/local-infer/unregister',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'unregister payload too large')
        sendJson(res, 200, await unregisterFor(localInfer, registerRequestFromBody(body)))
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
