/**
 * The POST /local-infer/chat-template route: the card's auto-download (and
 * the System-dependencies fallback) pulls a selected template into the model
 * directory through this route, so a picked preset works out of the box.
 * @module dsh-plugin-local-infer/ui/routes/chat-template
 */

import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import type { ChatTemplateDownloadRequest } from '../request.ts'
import { chatTemplateDownloadFor } from '../ops/hf.ts'

/**
 * chatTemplateRoute builds the POST /local-infer/chat-template route
 * definition the register step holds by an effect.
 */
export function chatTemplateRoute(localInfer: LocalInferService): LocalInferRoute {
  return defineRoute({
    name: 'local-infer-chat-template',
    path: '/local-infer/chat-template',
    method: 'POST',
    failStatus: 500,
    tooLargeMessage: 'chat template payload too large',
    run: async ({ body }, res) => {
      // exactOptionalPropertyTypes: build the request object with only the
      // keys that are present, so an absent value never writes `undefined`.
      const request: ChatTemplateDownloadRequest = {}
      if (typeof body.engine === 'string') {
        request.engine = body.engine
      }
      if (typeof body.template === 'string') {
        request.template = body.template
      }
      if (typeof body.directory === 'string') {
        request.directory = body.directory
      }
      res.json(200, await chatTemplateDownloadFor(localInfer, request))
    },
  })
}
