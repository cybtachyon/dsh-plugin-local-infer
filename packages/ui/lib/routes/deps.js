/**
 * The GET /local-infer/deps route: the deps panel read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the dep plan, the
 * per-dep statuses, the copy/paste install string, and the Play/Run trust
 * gate.
 * @module dsh-plugin-local-infer/ui/routes/deps
 */
import { defineRoute } from "../route.js";
import { depsRequestFromUrl } from "../request.js";
import { buildDeps } from "../viewmodels/deps.js";
/**
 * depsRoute builds the GET /local-infer/deps route definition the register
 * step holds by an effect.
 */
export function depsRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-deps',
        path: '/local-infer/deps',
        method: 'GET',
        failStatus: 500,
        run: async ({ url }, res) => {
            res.json(200, await buildDeps(localInfer, depsRequestFromUrl(url)));
        },
    });
}
//# sourceMappingURL=deps.js.map