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
import type { LifecycleHost } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * getRoute builds the POST /local-infer/get route definition the register
 * step holds by an effect. The optional getHost is the lifecycle host the
 * git and build steps run through; it defaults to the node host, and a test
 * injects a stub so the route never clones a real repo in CI.
 */
export declare function getRoute(localInfer: LocalInferService, getHost?: LifecycleHost): LocalInferRoute;
//# sourceMappingURL=get.d.ts.map
