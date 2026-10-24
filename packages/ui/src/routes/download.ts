/**
 * The POST /local-infer/download route: it runs the hf CLI download for the
 * request's default model, resolving the entry through the providers'
 * default list (a 404 when no entry names the pair) and the directory
 * against the request, the stored config, and the plugin's default model
 * directory in that order.
 * @module dsh-plugin-local-infer/ui/routes/download
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { DownloadRequest, LocalInferRoute } from '../route.ts'
import { downloadFor, readJsonBody, requireMethod, RouteError, sendJson } from '../route.ts'

/**
 * downloadRoute builds the POST /local-infer/download route definition the
 * register step holds by an effect.
 */
export function downloadRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-download',
    kind: 'exact',
    path: '/local-infer/download',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'download payload too large')
        // exactOptionalPropertyTypes: build the request object with only the
        // keys that are present, so an absent value never writes `undefined`.
        const request: DownloadRequest = {}
        if (typeof body.engine === 'string') {
          request.engine = body.engine
        }
        if (typeof body.model === 'string') {
          request.model = body.model
        }
        if (typeof body.directory === 'string') {
          request.directory = body.directory
        }
        sendJson(res, 200, await downloadFor(localInfer, request))
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
