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
import type { LifecycleHost } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect. The optional launchHost is the lifecycle
 * host the launch's Get steps (git sync, build) run through; it defaults to
 * the node host, and a test injects a stub so the route never clones a real
 * repo in CI.
 */
export declare function launchRoute(localInfer: LocalInferService, launchHost?: LifecycleHost): LocalInferRoute;
//# sourceMappingURL=launch.d.ts.map
