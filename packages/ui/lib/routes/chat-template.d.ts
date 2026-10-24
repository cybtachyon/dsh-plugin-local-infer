/**
 * The POST /local-infer/chat-template route: the card's auto-download (and
 * the System-dependencies fallback) pulls a selected template into the model
 * directory through this route, so a picked preset works out of the box.
 * @module dsh-plugin-local-infer/ui/routes/chat-template
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * chatTemplateRoute builds the POST /local-infer/chat-template route
 * definition the register step holds by an effect.
 */
export declare function chatTemplateRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=chat-template.d.ts.map