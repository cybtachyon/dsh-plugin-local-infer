/**
 * The POST /local-infer/download route: it runs the hf CLI download for the
 * request's default model, resolving the entry through the providers'
 * default list (a 404 when no entry names the pair) and the directory
 * against the request, the stored config, and the plugin's default model
 * directory in that order.
 * @module dsh-plugin-local-infer/ui/routes/download
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * downloadRoute builds the POST /local-infer/download route definition the
 * register step holds by an effect.
 */
export declare function downloadRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=download.d.ts.map