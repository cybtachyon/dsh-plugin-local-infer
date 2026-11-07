/**
 * The hf CLI download operations: downloadFor runs the download for a default
 * model, and chatTemplateDownloadFor pulls a selected chat template into the
 * model directory. Both resolve the directory through resolveDownloadTarget
 * (the request, the stored config, and the hub cache root in that order,
 * through the shared override rule), so the hub-cache layout rule has one
 * home across the download routes and the card.
 * @module dsh-plugin-local-infer/ui/ops/hf
 */
import type { DownloadResult, LocalInferService } from 'dsh-plugin-local-infer/service';
import type { ChatTemplateDownloadRequest, DownloadRequest } from '../request.ts';
/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory through
 * resolveDownloadTarget, and runs the download through the service. The run
 * brackets one live hub run under the runLogKey rule keyed on the entry's
 * engine and model (a draft falls back to the engine id): the seed is the
 * "Downloading..." separator, the hf CLI's streamed chunks append as they
 * land, and the settled completion or failure line reaches the hub and the
 * persisted run from one text before the run ends.
 */
export declare function downloadFor(localInfer: LocalInferService, request: DownloadRequest): Promise<DownloadResult>;
/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory through resolveDownloadTarget, and
 * runs the download through the service. The run brackets one live hub run
 * under the "Downloading..." seed and the runLogKey rule (the stored entry
 * matching the engine and model, else the engine id): the hf CLI's streamed
 * chunks append as they land, and the run ends at settle.
 */
export declare function chatTemplateDownloadFor(localInfer: LocalInferService, request: ChatTemplateDownloadRequest): Promise<DownloadResult>;
//# sourceMappingURL=hf.d.ts.map
