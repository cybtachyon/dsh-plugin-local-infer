/**
 * The POST /local-infer/get route: the Get step. Its answer streams as plain
 * text, so the card appends the git sync, the dependency run, and the build
 * output to its Logs section as it lands. The full run persists as the
 * last-run logs.
 * @module dsh-plugin-local-infer/ui/routes/get
 */

import type { Config, LifecycleHost } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { GetRequest, LocalInferRoute } from '../route.ts'
import {
  getEngine,
  parseStoredPlatformConfig,
  persistGetLogs,
  readJsonBody,
  requireMethod,
  RouteError,
  sendJson,
} from '../route.ts'

/**
 * getRoute builds the POST /local-infer/get route definition the register
 * step holds by an effect. The optional getHost is the lifecycle host the
 * git and build steps run through; it defaults to the node host, and a test
 * injects a stub so the route never clones a real repo in CI.
 */
export function getRoute(
  localInfer: LocalInferService,
  getHost?: LifecycleHost,
): LocalInferRoute {
  return {
    name: 'local-infer-get',
    kind: 'exact',
    path: '/local-infer/get',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'get payload too large')
        const request: GetRequest = {}
        if (typeof body.engine === 'string') {
          request.engine = body.engine
        }
        if (body.config && typeof body.config === 'object') {
          request.config = body.config as Config
        }
        const platform = parseStoredPlatformConfig(body.platform)
        if (platform !== undefined) {
          request.platform = platform
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        let collected = ''
        const log = (text: string): void => {
          collected += text
          if (typeof res.write === 'function') {
            res.write(text)
          }
        }
        try {
          await getEngine(localInfer, request, log, getHost)
        } catch (error) {
          log(`!! get failed: ${String((error as Error)?.message ?? error)}\n`)
        }
        persistGetLogs(collected)
        res.end()
      } catch (error) {
        if (error instanceof RouteError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 400, { error: String((error as Error)?.message ?? error) })
      }
    },
  }
}
