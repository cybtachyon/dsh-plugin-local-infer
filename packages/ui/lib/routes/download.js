/**
 * The POST /local-infer/download route: it runs the hf CLI download for the
 * request's default model, resolving the entry through the providers'
 * default list (a 404 when no entry names the pair) and the directory
 * against the request, the stored config, and the plugin's default model
 * directory in that order. The run's live hub bracket (seed, streamed hf
 * chunks, settle line, end) and its persisted "Downloading..." section both
 * live in downloadFor (ops/hf.ts), so the text has one home.
 * @module dsh-plugin-local-infer/ui/routes/download
 */
import { defineRoute } from "../route.js";
import { downloadFor } from "../ops/hf.js";
import { abortOnResponseClose } from "./stream.js";
/**
 * downloadRoute builds the POST /local-infer/download route definition the
 * register step holds by an effect.
 */
export function downloadRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-download',
        path: '/local-infer/download',
        method: 'POST',
        failStatus: 500,
        tooLargeMessage: 'download payload too large',
        run: async ({ body }, res) => {
            // exactOptionalPropertyTypes: build the request object with only the
            // keys that are present, so an absent value never writes `undefined`.
            const request = {};
            if (typeof body.engine === 'string') {
                request.engine = body.engine;
            }
            if (typeof body.model === 'string') {
                request.model = body.model;
            }
            if (typeof body.directory === 'string') {
                request.directory = body.directory;
            }
            // The card's Cancel aborts the fetch, which closes the response: the
            // abort interrupts the in-flight hf child (SIGINT, then SIGTERM) and
            // the run carries the "Canceled" line, the Get and launch routes'
            // rule. A close after the download settled is the normal end.
            const { signal, markFinished } = abortOnResponseClose(res);
            try {
                res.json(200, await downloadFor(localInfer, request, signal));
            }
            finally {
                markFinished();
            }
        },
    });
}
//# sourceMappingURL=download.js.map
