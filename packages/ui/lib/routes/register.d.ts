/**
 * The POST /local-infer/register route: it renders the plan through the
 * registered adapter, resolves the model row and the context window, and
 * runs the service's register entry point, which upserts the provider and
 * model through the settings seam. The result carries the entry the
 * registrar wrote, so the card names the model it published.
 * @module dsh-plugin-local-infer/ui/routes/register
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * registerRoute builds the POST /local-infer/register route definition the
 * register step holds by an effect.
 */
export declare function registerRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=register.d.ts.map