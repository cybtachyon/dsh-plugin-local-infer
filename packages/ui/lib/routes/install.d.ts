/**
 * The POST /local-infer/install route: the Play/Run path. It refuses with a
 * 409 while the trust gate is off (the copy/paste path is always the
 * fallback), runs the install through the service, and answers with the
 * install result and the refreshed deps model, so the card re-renders the
 * gate from the same re-check the install ran.
 * @module dsh-plugin-local-infer/ui/routes/install
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * installRoute builds the POST /local-infer/install route definition the
 * register step holds by an effect.
 */
export declare function installRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=install.d.ts.map