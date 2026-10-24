/**
 * The GET /local-infer/summary route: the card's read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the summary the
 * card renders.
 * @module dsh-plugin-local-infer/ui/routes/summary
 */
import { defineRoute } from "../route.js";
import { depsRequestFromUrl } from "../request.js";
import { buildSummary } from "../viewmodels/summary.js";
/**
 * summaryRoute builds the GET /local-infer/summary route definition the
 * register step holds by an effect.
 */
export function summaryRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-config',
        path: '/local-infer/summary',
        method: 'GET',
        failStatus: 500,
        run: async ({ url }, res) => {
            res.json(200, await buildSummary(localInfer, depsRequestFromUrl(url)));
        },
    });
}
//# sourceMappingURL=summary.js.map