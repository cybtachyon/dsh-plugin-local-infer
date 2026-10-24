/**
 * The POST /local-infer/register route: it renders the plan through the
 * registered adapter, resolves the model row and the context window, and
 * runs the service's register entry point, which upserts the provider and
 * model through the settings seam. The result carries the entry the
 * registrar wrote, so the card names the model it published.
 * @module dsh-plugin-local-infer/ui/routes/register
 */
import { registerFor } from "../ops/model.js";
import { defineRoute } from "../route.js";
import { registerRequestFromBody } from "../request.js";
/**
 * registerRoute builds the POST /local-infer/register route definition the
 * register step holds by an effect.
 */
export function registerRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-register',
        path: '/local-infer/register',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'register payload too large',
        run: async ({ body }, res) => {
            res.json(200, await registerFor(localInfer, registerRequestFromBody(body)));
        },
    });
}
//# sourceMappingURL=register.js.map