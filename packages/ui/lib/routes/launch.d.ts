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
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * launchRoute builds the POST /local-infer/launch route definition the
 * register step holds by an effect.
 */
export declare function launchRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=launch.d.ts.map