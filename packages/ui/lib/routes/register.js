/**
 * The POST /local-infer/register route: it renders the plan through the
 * registered adapter, resolves the model row and the context window, and
 * runs the service's register entry point, which upserts the provider and
 * model through the settings seam. The result carries the entry the
 * registrar wrote, so the card names the model it published.
 * @module dsh-plugin-local-infer/ui/routes/register
 */
import { readJsonBody, registerFor, registerRequestFromBody, requireMethod, RouteError, sendJson, } from "../route.js";
/**
 * registerRoute builds the POST /local-infer/register route definition the
 * register step holds by an effect.
 */
export function registerRoute(localInfer) {
    return {
        name: 'local-infer-register',
        kind: 'exact',
        path: '/local-infer/register',
        handler: async (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            try {
                const body = await readJsonBody(req, 'register payload too large');
                sendJson(res, 200, await registerFor(localInfer, registerRequestFromBody(body)));
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
//# sourceMappingURL=register.js.map