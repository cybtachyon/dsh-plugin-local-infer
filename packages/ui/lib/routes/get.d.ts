/**
 * The POST /local-infer/get route: the Get step. Its answer streams as plain
 * text, so the card appends the git sync, the dependency run, and the build
 * output to its Logs section as it lands. The full run persists as the
 * last-run logs.
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