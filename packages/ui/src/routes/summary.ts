/**
 * The GET /local-infer/summary route: the card's read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the summary the
 * card renders.
 * @module dsh-plugin-local-infer/ui/routes/summary
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { depsRequestFromUrl } from '../request.ts'
import { buildSummary } from '../viewmodels/summary.ts'

/**
 * summaryRoute builds the GET /local-infer/summary route definition the
 * register step holds by an effect.
 */
export function summaryRoute(localInfer: LocalInferService): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-config',
    path: '/local-infer/summary',
    method: 'GET',
    failStatus: 500,
    run: async ({ url }, res) => {
      res.json(200, await buildSummary(localInfer, depsRequestFromUrl(url)))
    },
  })
}
