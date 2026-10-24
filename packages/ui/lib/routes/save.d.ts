/**
 * The POST /local-infer/save route: it upserts a provider entry (an id
 * updates the stored entry in place, an absent id mints a new id and
 * prepends the entry), persists the global fields the card's toggles edit,
 * re-syncs the service's platform registry with the saved map, and re-runs
 * the registration for an already-registered model so its input types stay
 * in step with the saved config.
 * @module dsh-plugin-local-infer/ui/routes/save
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * saveRoute builds the POST /local-infer/save route definition the register
 * step holds by an effect.
 */
export declare function saveRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=save.d.ts.map