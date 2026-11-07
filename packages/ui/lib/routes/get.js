/**
 * The POST /local-infer/get route: the Get step. Its answer streams as
 * NDJSON progress events only (a structured download state folded from the
 * hf download's tqdm stderr): the run's log text reaches the card through
 * the per-provider run-log stream (the GET /local-infer/logs route fed by the
 * hub), so one line never arrives twice. The full run still collects,
 * persists as the last-run logs in plain text, and feeds the live hub, so
 * the log file, the Logs section, and the streamed run read the run the same
 * way.
 * @module dsh-plugin-local-infer/ui/routes/get
 */
import { runLogKey } from '../../../service/lib/index.js';
import { parseStoredPlatformConfig } from "../config.js";
import { CANCELED_LINE, GET_EVENT_PREFIX, getEngine, resolveStoredRequest } from "../ops/engine.js";
import { captureRunBaseline, finishRunSection, GET_RUN_SEED } from "../ops/logs.js";
import { defineRoute } from "../route.js";
import { abortOnResponseClose, ndjsonLine, throttledProgressSink } from "./stream.js";
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
            res.ndjsonStream();
            // The run key the live hub buffers this Get under, the shared runLogKey
            // rule (the request names no provider, so the stored entry matching the
            // engine and model wins, and a draft falls back to the engine id).
            const { stored, engineId, config } = resolveStoredRequest(request);
            const runKey = runLogKey(stored.providers, engineId, undefined, config);
            localInfer.beginRun(runKey, GET_RUN_SEED);
            // The stored last-run logs as they stand before the run persists
            // anything: the sudo observer persists its note while the run hangs on
            // the prompt, and finishRunSection closes the run over the baseline so
            // that provisional line and the collected run text persist once.
            const baseline = captureRunBaseline();
            let collected = '';
            // The log sink collects the plain-text run (the persisted log) and
            // appends the same chunk to the live hub, whose run-log stream carries
            // the text to the card's Logs pane (Q2: one streamed display path).
            // The route's own answer no longer mirrors the text as log events, so
            // a line never lands twice.
            const log = (text) => {
                collected += text;
                localInfer.appendRunLog(runKey, text);
            };
            // The hf download's raw stderr sink: the core chunk folder turns the
            // tqdm lines into a structured state, and the sink emits a progress
            // event when a fold yields one (throttled to the half-second cadence).
            const onChunk = throttledProgressSink((progress) => ndjsonLine(res, { progress }));
            // The card's provider-form Cancel aborts the fetch, which closes the
            // response: the abort interrupts the in-flight hf child (SIGINT, then
            // SIGTERM). Resume is within-invocation only; a killed run re-downloads
            // from zero on the re-run (the orphaned .incomplete blob lingers until
            // `hf cache prune`). A close after the run settled is the normal end,
            // not a cancel.
            const { signal, markFinished } = abortOnResponseClose(res);
            try {
                try {
                    await getEngine(localInfer, request, log, getHost, signal, onChunk);
                }
                catch (error) {
                    log(`${GET_EVENT_PREFIX}get failed: ${String(error?.message ?? error)}\n`);
                }
                // A cancel that closed the stream appends the "Canceled" line, so the
                // persisted run (and the log file) read the run as canceled, the same
                // line the card writes to its Logs buffer on the Cancel.
                if (signal.aborted) {
                    log(`${CANCELED_LINE}`);
                }
                markFinished();
                // The "Getting engine and model..." separator leads the persisted
                // run and the live run's seed, so the Logs section, the log file, and
                // the streamed run read the run as one fresh process section.
                // finishRunSection closes the run over the baseline captured before
                // it started, not a second append over its own provisional notes.
                finishRunSection(baseline, `${GET_RUN_SEED}${collected}`);
                res.end();
            }
            finally {
                // The bracket closes on every settle path, cancel and failure
                // included: the key's running flag clears after finishRunSection.
                localInfer.endRun(runKey);
            }
        },
    });
}
//# sourceMappingURL=get.js.map
