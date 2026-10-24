/**
 * The POST /local-infer/launch route: it renders the plan the registered
 * adapter produces and runs the service's launch entry point (deploy, then
 * the health poll). The launch streams its progress as NDJSON: a step event
 * as each phase (prereqs, download, build, launch) begins, then a final
 * result event. The card's Launch control reads the step that is running and
 * times out only the launch (health-poll) step; the rebuild steps run as
 * long as they need to.
 * @module dsh-plugin-local-infer/ui/routes/launch
 */
import { launchEngine } from "../ops/engine.js";
import { defineRoute, RouteError } from "../route.js";
import { launchRequestFromBody } from "../request.js";
/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect.
 */
export function launchRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-launch',
        path: '/local-infer/launch',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'launch payload too large',
        run: async ({ body }, res) => {
            res.ndjsonStream();
            const writeLine = (line) => {
                res.write(JSON.stringify(line) + '\n');
            };
            const onProgress = (step) => {
                writeLine({ step });
            };
            try {
                const result = await launchEngine(localInfer, launchRequestFromBody(body), onProgress);
                writeLine({ result });
            }
            catch (error) {
                // A launch that breaks before a plan renders (an unknown engine, a
                // hardware probe failure) still settles the card's control to the red
                // Logs state through a result event, not a bare 500.
                const detail = error instanceof RouteError
                    ? error.message
                    : String(error?.message ?? error);
                writeLine({ result: { healthy: false, detail } });
            }
            res.end();
        },
    });
}
//# sourceMappingURL=launch.js.map