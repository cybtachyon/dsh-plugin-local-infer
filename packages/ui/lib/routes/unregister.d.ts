/**
 * The POST /local-infer/unregister route: it runs the service's removeModel
 * entry point for the engine's provider and the model row the register step
 * resolved, so the removal targets the exact entry the registration wrote.
 * @module dsh-plugin-local-infer/ui/routes/unregister
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * unregisterRoute builds the POST /local-infer/unregister route definition
 * the register step holds by an effect.
 */
export declare function unregisterRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=unregister.d.ts.map