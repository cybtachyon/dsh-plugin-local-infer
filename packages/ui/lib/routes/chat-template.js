/**
 * The POST /local-infer/chat-template route: the card's auto-download (and
 * the System-dependencies fallback) pulls a selected template into the model
 * directory through this route, so a picked preset works out of the box.
 * @module dsh-plugin-local-infer/ui/routes/chat-template
 */
import { chatTemplateDownloadFor, readJsonBody, requireMethod, RouteError, sendJson, } from "../route.js";
/**
 * chatTemplateRoute builds the POST /local-infer/chat-template route
 * definition the register step holds by an effect.
 */
export function chatTemplateRoute(localInfer) {
    return {
        name: 'local-infer-chat-template',
        kind: 'exact',
        path: '/local-infer/chat-template',
        handler: async (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            try {
                const body = await readJsonBody(req, 'chat template payload too large');
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
                sendJson(res, 200, await chatTemplateDownloadFor(localInfer, request));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    sendJson(res, error.status, { error: error.message });
                    return;
                }
                sendJson(res, 500, { error: String(error?.message ?? error) });
            }
        },
    };
}
//# sourceMappingURL=chat-template.js.map