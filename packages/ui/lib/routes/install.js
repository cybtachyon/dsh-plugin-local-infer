/**
 * The POST /local-infer/install route: the Play/Run path. It refuses with a
 * 409 while the trust gate is off (the copy/paste path is always the
 * fallback), runs the install through the service, and answers with the
 * install result and the refreshed deps model, so the card re-renders the
 * gate from the same re-check the install ran.
 * @module dsh-plugin-local-infer/ui/routes/install
 */
import { defineRoute } from "../route.js";
import { runInstallFor } from "../viewmodels/depsHelpers.js";
/**
 * installRoute builds the POST /local-infer/install route definition the
 * register step holds by an effect.
 */
export function installRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-install',
        path: '/local-infer/install',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'install payload too large',
        run: async ({ body }, res) => {
            // exactOptionalPropertyTypes: build the request object with only the
            // keys that are present, so an absent value never writes `undefined`.
            const request = {};
            if (typeof body.engine === 'string') {
                request.engine = body.engine;
            }
            if (body.config && typeof body.config === 'object') {
                request.config = body.config;
            }
            res.json(200, await runInstallFor(localInfer, request));
        },
    });
}
//# sourceMappingURL=install.js.map