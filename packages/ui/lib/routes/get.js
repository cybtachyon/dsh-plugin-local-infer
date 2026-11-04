/**
 * The POST /local-infer/get route: the Get step. Its answer streams as plain
 * text, so the card appends the git sync, the dependency run, and the build
 * output to its Logs section as it lands. The full run persists as the
 * last-run logs.
 * @module dsh-plugin-local-infer/ui/routes/get
 */
import { parseStoredPlatformConfig } from "../config.js";
import { CANCELED_LINE, getEngine } from "../ops/engine.js";
import { persistGetLogs } from "../ops/logs.js";
import { defineRoute } from "../route.js";
/**
 * getRoute builds the POST /local-infer/get route definition the register
 * step holds by an effect. The optional getHost is the lifecycle host the
 * git and build steps run through; it defaults to the node host, and a test
 * injects a stub so the route never clones a real repo in CI.
 */
export function getRoute(localInfer, getHost) {
    return defineRoute({
        name: 'local-infer-get',
        path: '/local-infer/get',
        method: 'POST',
        failStatus: 400,
        tooLargeMessage: 'get payload too large',
        run: async ({ body }, res) => {
            const request = {};
            if (typeof body.engine === 'string') {
                request.engine = body.engine;
            }
            if (body.config && typeof body.config === 'object') {
                request.config = body.config;
            }
            const platform = parseStoredPlatformConfig(body.platform);
            if (platform !== undefined) {
                request.platform = platform;
            }
            res.textStream();
            let collected = '';
            const log = (text) => {
                collected += text;
                res.write(text);
            };
            // The card's provider-form Cancel aborts the fetch, which closes the
            // response: the abort interrupts the in-flight hf child (SIGINT, then
            // SIGTERM), and the hub-cache .incomplete blob resumes on the re-run.
            // A close after the run settled is the normal end, not a cancel.
            const controller = new AbortController();
            let finished = false;
            res.onClose(() => {
                if (!finished) {
                    controller.abort();
                }
            });
            try {
                await getEngine(localInfer, request, log, getHost, controller.signal);
            }
            catch (error) {
                log(`!! get failed: ${String(error?.message ?? error)}\n`);
            }
            // A cancel that closed the stream appends the "Canceled" line, so the
            // persisted run (and the log file) read the run as canceled, the same
            // line the card writes to its Logs buffer on the Cancel.
            if (controller.signal.aborted) {
                log(`${CANCELED_LINE}`);
            }
            finished = true;
            // The "Getting engine and model..." separator leads the persisted run,
            // so the Logs section and the log file read the run as a fresh process
            // section, the same line the card writes when the Get button is
            // clicked.
            persistGetLogs(`--- Getting engine and model...\n${collected}`);
            res.end();
        },
    });
}
//# sourceMappingURL=get.js.map
