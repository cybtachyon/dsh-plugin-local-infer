/**
 * The POST /local-infer/install route: the Play/Run path. It refuses with a
 * 409 while the trust gate is off (the copy/paste path is always the
 * fallback), runs the install through the service, and answers with the
 * install result and the refreshed deps model, so the card re-renders the
 * gate from the same re-check the install ran.
 * @module dsh-plugin-local-infer/ui/routes/install
 */

import type { Config } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { DepsRequest, LocalInferRoute } from '../route.ts'
import { readJsonBody, requireMethod, RouteError, runInstallFor, sendJson } from '../route.ts'

/**
 * installRoute builds the POST /local-infer/install route definition the
 * register step holds by an effect.
 */
export function installRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-install',
    kind: 'exact',
    path: '/local-infer/install',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'install payload too large')
        // exactOptionalPropertyTypes: build the request object with only the
        // keys that are present, so an absent value never writes `undefined`.
        const request: DepsRequest = {}
        if (typeof body.engine === 'string') {
          request.engine = body.engine
        }
        if (body.config && typeof body.config === 'object') {
          request.config = body.config as Config
        }
        sendJson(res, 200, await runInstallFor(localInfer, request))
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
