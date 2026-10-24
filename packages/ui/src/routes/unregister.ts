/**
 * The POST /local-infer/unregister route: it runs the service's removeModel
 * entry point for the engine's provider and the model row the register step
 * resolved, so the removal targets the exact entry the registration wrote.
 * @module dsh-plugin-local-infer/ui/routes/unregister
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { unregisterFor } from '../ops/model.ts'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { registerRequestFromBody } from '../request.ts'

/**
 * unregisterRoute builds the POST /local-infer/unregister route definition
 * the register step holds by an effect.
 */
export function unregisterRoute(localInfer: LocalInferService): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-unregister',
    path: '/local-infer/unregister',
    method: 'POST',
    failStatus: 500,
    tooLargeMessage: 'unregister payload too large',
    run: async ({ body }, res) => {
      res.json(200, await unregisterFor(localInfer, registerRequestFromBody(body)))
    },
  })
}
