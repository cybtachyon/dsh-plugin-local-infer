/**
 * The GET /local-infer/deps route: the deps panel read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the dep plan, the
 * per-dep statuses, the copy/paste install string, and the Play/Run trust
 * gate.
 * @module dsh-plugin-local-infer/ui/routes/deps
 */
import { buildDeps, depsRequestFromUrl, requireMethod, RouteError, sendJson } from "../route.js";
/**
 * depsRoute builds the GET /local-infer/deps route definition the register
 * step holds by an effect.
 */
export function depsRoute(localInfer) {
    return {
        name: 'local-infer-deps',
        kind: 'exact',
        path: '/local-infer/deps',
        handler: async (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            try {
                const url = new URL(req.url, 'http://localhost');
                sendJson(res, 200, await buildDeps(localInfer, depsRequestFromUrl(url)));
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
//# sourceMappingURL=deps.js.map