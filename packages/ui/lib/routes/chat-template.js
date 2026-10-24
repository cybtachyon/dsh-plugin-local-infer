/**
 * The POST /local-infer/chat-template route: the card's auto-download (and
 * the System-dependencies fallback) pulls a selected template into the model
 * directory through this route, so a picked preset works out of the box.
 * @module dsh-plugin-local-infer/ui/routes/chat-template
 */
import { defineRoute } from "../route.js";
import { chatTemplateDownloadFor } from "../ops/hf.js";
/**
 * chatTemplateRoute builds the POST /local-infer/chat-template route
 * definition the register step holds by an effect.
 */
export function chatTemplateRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-chat-template',
        path: '/local-infer/chat-template',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'chat template payload too large',
        run: async ({ body }, res) => {
            // exactOptionalPropertyTypes: build the request object with only the
            // keys that are present, so an absent value never writes `undefined`.
            const request = {};
            if (typeof body.engine === 'string') {
                request.engine = body.engine;
            }
            if (typeof body.template === 'string') {
                request.template = body.template;
            }
            if (typeof body.directory === 'string') {
                request.directory = body.directory;
            }
            res.json(200, await chatTemplateDownloadFor(localInfer, request));
        },
    });
}
//# sourceMappingURL=chat-template.js.map