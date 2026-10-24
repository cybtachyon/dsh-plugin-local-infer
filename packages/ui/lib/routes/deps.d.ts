/**
 * The GET /local-infer/deps route: the deps panel read model. The handler
 * parses the engine and config query params (an absent engine or a broken
 * config falls back to the stored config) and answers with the dep plan, the
 * per-dep statuses, the copy/paste install string, and the Play/Run trust
 * gate.
 * @module dsh-plugin-local-infer/ui/routes/deps
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * depsRoute builds the GET /local-infer/deps route definition the register
 * step holds by an effect.
 */
export declare function depsRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=deps.d.ts.map