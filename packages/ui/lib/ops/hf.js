/**
 * The hf CLI download operations: downloadFor runs the download for a default
 * model, and chatTemplateDownloadFor pulls a selected chat template into the
 * model directory. Both resolve the directory against the request, the
 * stored config, and the plugin's default model directory in that order.
 * @module dsh-plugin-local-infer/ui/ops/hf
 */
import { defaultModelFor } from '../../../providers/lib/index.js';
import { readConfig } from "../config.js";
import { RouteError } from "../route.js";
import { isHfRepoReference } from "../viewmodels/summaryHelpers.js";
/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory against the request, the
 * stored config, and the plugin's default model directory in that order, and
 * runs the download through the service.
 */
export async function downloadFor(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const modelId = request.model ?? (typeof stored.config.model === 'string' ? stored.config.model : '');
    const entry = defaultModelFor(engineId, modelId);
    if (entry === undefined) {
        throw new RouteError(404, `no default model is registered for "${engineId}/${modelId}"`);
    }
    const storedDir = stored.config.modelDirectory;
    const directory = typeof request.directory === 'string' && request.directory.trim() !== ''
        ? request.directory
        : typeof storedDir === 'string' && storedDir.trim() !== ''
            ? storedDir
            : localInfer.defaultModelDirectory();
    return localInfer.downloadModel(entry, directory);
}
/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory against the request, the stored config,
 * and the plugin's default model directory in that order, and runs the
 * download through the service.
 */
export async function chatTemplateDownloadFor(localInfer, request) {
    const stored = readConfig();
    let template = typeof request.template === 'string' ? request.template : '';
    if (template.trim() === '') {
        template = typeof stored.config.chatTemplate === 'string' ? stored.config.chatTemplate : '';
    }
    if (!isHfRepoReference(template)) {
        throw new RouteError(400, `the chat template must be an HF repo reference, got "${template || '(none)'}"`);
    }
    const storedDir = stored.config.modelDirectory;
    const directory = typeof request.directory === 'string' && request.directory.trim() !== ''
        ? request.directory
        : typeof storedDir === 'string' && storedDir.trim() !== ''
            ? storedDir
            : localInfer.defaultModelDirectory();
    return localInfer.downloadChatTemplate(template, directory);
}
//# sourceMappingURL=hf.js.map