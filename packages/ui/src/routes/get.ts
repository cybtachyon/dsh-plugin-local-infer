/**
 * The POST /local-infer/get route: the Get step. Its answer streams as plain
 * text, so the card appends the git sync, the dependency run, and the build
 * output to its Logs section as it lands. The full run persists as the
 * last-run logs.
 * @module dsh-plugin-local-infer/ui/routes/get
 */

import type { Config, LifecycleHost } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { parseStoredPlatformConfig } from '../config.ts'
import { getEngine } from '../ops/engine.ts'
import { persistGetLogs } from '../ops/logs.ts'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import type { GetRequest } from '../request.ts'

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
  return defineRoute({
    name: 'local-infer-get',
    path: '/local-infer/get',
    method: 'POST',
    failStatus: 400,
    tooLargeMessage: 'get payload too large',
    run: async ({ body }, res) => {
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
      res.textStream()
      let collected = ''
      const log = (text: string): void => {
        collected += text
        res.write(text)
      }
      try {
        await getEngine(localInfer, request, log, getHost)
      } catch (error) {
        log(`!! get failed: ${String((error as Error)?.message ?? error)}\n`)
      }
      persistGetLogs(collected)
      res.end()
    },
  })
}
