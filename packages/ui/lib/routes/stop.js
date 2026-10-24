/**
 * The POST /local-infer/stop route: it renders the same plan the launch
 * rendered and runs the service's stop entry point, so the stop targets the
 * exact container or process the launch started. The stop then clears the
 * target entry's launch record, so a recycled pid cannot re-link an engine
 * the user just stopped.
 * @module dsh-plugin-local-infer/ui/routes/stop
 */
import { stopEngine } from "../ops/engine.js";
import { defineRoute } from "../route.js";
import { launchRequestFromBody } from "../request.js";
/**
 * stopRoute builds the POST /local-infer/stop route definition the register
 * step holds by an effect.
 */
export function stopRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-stop',
        path: '/local-infer/stop',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'stop payload too large',
        run: async ({ body }, res) => {
            await stopEngine(localInfer, launchRequestFromBody(body));
            res.json(200, { stopped: true });
        },
    });
}
//# sourceMappingURL=stop.js.map