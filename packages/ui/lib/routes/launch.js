/**
 * The POST /local-infer/launch route: it renders the plan the registered
 * adapter produces and runs the service's launch entry point (deploy, then
 * the health poll). The launch streams its progress as NDJSON: a step event
 * as each phase (prereqs, download, build, launch) begins, a progress event
 * when the Get-steps hf download's tqdm stderr folds into a structured
 * state, then a final result event. The card's Launch control reads the step
 * that is running and times out only the launch (health-poll) step; the
 * rebuild steps run as long as they need to.
 * @module dsh-plugin-local-infer/ui/routes/launch
 */
import { nodeLifecycleHost } from '../../../providers/lib/index.js';
import { launchEngine } from "../ops/engine.js";
import { defineRoute, RouteError } from "../route.js";
import { launchRequestFromBody } from "../request.js";
import { abortOnResponseClose, ndjsonLine, throttledProgressSink } from "./stream.js";
/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect. The optional launchHost is the lifecycle
 * host the launch's Get steps (git sync, build) run through; it defaults to
 * the node host, and a test injects a stub so the route never clones a real
 * repo in CI.
 */
export function launchRoute(localInfer, launchHost = nodeLifecycleHost) {
    return defineRoute({
        name: 'local-infer-launch',
        path: '/local-infer/launch',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'launch payload too large',
        run: async ({ body }, res) => {
            res.ndjsonStream();
            const writeLine = (line) => {
                ndjsonLine(res, line);
            };
            const onProgress = (step) => {
                writeLine({ step });
            };
            // The Get-steps hf download's raw stderr sink: the core chunk folder
            // turns the tqdm lines into a structured state, and the sink emits a
            // progress event when a fold yields one (throttled to the half-second
            // cadence), between the step and result events.
            const onChunk = throttledProgressSink((progress) => writeLine({ progress }));
            // The card's provider-form Cancel aborts the fetch, which closes the
            // response: the abort interrupts the in-flight Get-step hf child
            // (SIGINT, then SIGTERM), and the persisted run carries the "Canceled"
            // line. A close after the run settled is the normal end, not a cancel.
            const { signal, markFinished } = abortOnResponseClose(res);
            try {
                const result = await launchEngine(localInfer, launchRequestFromBody(body), onProgress, launchHost, signal, onChunk);
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
            markFinished();
            res.end();
        },
    });
}
//# sourceMappingURL=launch.js.map
