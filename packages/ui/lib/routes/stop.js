/**
 * The POST /local-infer/stop route: it renders the same plan the launch
 * rendered and runs the service's stop entry point, so the stop targets the
 * exact container or process the launch started. The stop then clears the
 * target entry's launch record, so a recycled pid cannot re-link an engine
 * the user just stopped.
 * @module dsh-plugin-local-infer/ui/routes/stop
 */
import { launchRequestFromBody, readJsonBody, requireMethod, RouteError, sendJson, stopEngine, } from "../route.js";
/**
 * stopRoute builds the POST /local-infer/stop route definition the register
 * step holds by an effect.
 */
export function stopRoute(localInfer) {
    return {
        name: 'local-infer-stop',
        kind: 'exact',
        path: '/local-infer/stop',
        handler: async (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            try {
                const body = await readJsonBody(req, 'stop payload too large');
                await stopEngine(localInfer, launchRequestFromBody(body));
                sendJson(res, 200, { stopped: true });
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
//# sourceMappingURL=stop.js.map