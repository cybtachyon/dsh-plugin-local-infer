/**
 * The POST /local-infer/get route: the Get step. Its answer streams as
 * NDJSON: a log event per log line the card appends to its Logs section, and
 * a progress event when the hf download's tqdm stderr (the onChunk sink)
 * folds into a structured state. The full run persists as the last-run logs
 * in plain text, so the log file and the Logs section read the run the same
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
