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
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import type { DepsRequest } from '../request.ts'
import { runInstallFor } from '../viewmodels/depsHelpers.ts'

/**
 * installRoute builds the POST /local-infer/install route definition the
 * register step holds by an effect.
 */
export function installRoute(localInfer: LocalInferService): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-install',
    path: '/local-infer/install',
    method: 'POST',
    failStatus: 500,
    tooLargeMessage: 'install payload too large',
    run: async ({ body }, res) => {
      // exactOptionalPropertyTypes: build the request object with only the
      // keys that are present, so an absent value never writes `undefined`.
      const request: DepsRequest = {}
      if (typeof body.engine === 'string') {
        request.engine = body.engine
      }
      if (body.config && typeof body.config === 'object') {
        request.config = body.config as Config
      }
      res.json(200, await runInstallFor(localInfer, request))
    },
  })
}
