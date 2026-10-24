/**
 * The POST /local-infer/download route: it runs the hf CLI download for the
 * request's default model, resolving the entry through the providers'
 * default list (a 404 when no entry names the pair) and the directory
 * against the request, the stored config, and the plugin's default model
 * directory in that order.
 * @module dsh-plugin-local-infer/ui/routes/download
 */
import { defineRoute } from "../route.js";
import { downloadFor } from "../ops/hf.js";
/**
 * downloadRoute builds the POST /local-infer/download route definition the
 * register step holds by an effect.
 */
export function downloadRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-download',
        path: '/local-infer/download',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'download payload too large',
        run: async ({ body }, res) => {
            // exactOptionalPropertyTypes: build the request object with only the
            // keys that are present, so an absent value never writes `undefined`.
            const request = {};
            if (typeof body.engine === 'string') {
                request.engine = body.engine;
            }
            if (typeof body.model === 'string') {
                request.model = body.model;
            }
            if (typeof body.directory === 'string') {
                request.directory = body.directory;
            }
            res.json(200, await downloadFor(localInfer, request));
        },
    });
}
//# sourceMappingURL=download.js.map