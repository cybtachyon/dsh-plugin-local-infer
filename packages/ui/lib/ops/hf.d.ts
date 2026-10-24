/**
 * The hf CLI download operations: downloadFor runs the download for a default
 * model, and chatTemplateDownloadFor pulls a selected chat template into the
 * model directory. Both resolve the directory against the request, the
 * stored config, and the plugin's default model directory in that order.
 * @module dsh-plugin-local-infer/ui/ops/hf
 */
import type { DownloadResult, LocalInferService } from 'dsh-plugin-local-infer/service';
import type { ChatTemplateDownloadRequest, DownloadRequest } from '../request.ts';
/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory against the request, the
 * stored config, and the plugin's default model directory in that order, and
 * runs the download through the service.
 */
export declare function downloadFor(localInfer: LocalInferService, request: DownloadRequest): Promise<DownloadResult>;
/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory against the request, the stored config,
 * and the plugin's default model directory in that order, and runs the
 * download through the service.
 */
export declare function chatTemplateDownloadFor(localInfer: LocalInferService, request: ChatTemplateDownloadRequest): Promise<DownloadResult>;
//# sourceMappingURL=hf.d.ts.map