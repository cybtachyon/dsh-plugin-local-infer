/**
 * The GET /local-infer/summary route: the card's read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the summary the
 * card renders.
 * @module dsh-plugin-local-infer/ui/routes/summary
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * summaryRoute builds the GET /local-infer/summary route definition the
 * register step holds by an effect.
 */
export declare function summaryRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=summary.d.ts.map