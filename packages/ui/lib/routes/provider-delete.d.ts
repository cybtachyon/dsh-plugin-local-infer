/**
 * The POST /local-infer/provider-delete route: it removes the stored
 * provider entry named by the body's id, keeps the rest of the list and the
 * active config intact, and re-syncs the service's platform registry so a
 * launch never reads a platform config the user just removed.
 * @module dsh-plugin-local-infer/ui/routes/provider-delete
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * providerDeleteRoute builds the POST /local-infer/provider-delete route
 * definition the register step holds by an effect.
 */
export declare function providerDeleteRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=provider-delete.d.ts.map