/**
 * The hf CLI download operations: downloadFor runs the download for a default
 * model, and chatTemplateDownloadFor pulls a selected chat template into the
 * model directory. Both resolve the directory through resolveDownloadTarget
 * (the request, the stored config, and the hub cache root in that order,
 * through the shared override rule), so the hub-cache layout rule has one
 * home across the download routes and the card.
 * @module dsh-plugin-local-infer/ui/ops/hf
 */
import { isModelDirectoryOverridden } from '../../../core/lib/index.js';
import { defaultModelFor } from '../../../providers/lib/index.js';
import { readConfig } from "../config.js";
import { RouteError } from "../route.js";
import { isHfRepoReference } from "../viewmodels/summaryHelpers.js";
/**
 * resolveDownloadTarget resolves the directory a download route targets: the
 * request's directory, the stored config's model directory, and the hub
 * cache root, in that order. The layout follows the shared override rule
 * (isModelDirectoryOverridden, the same rule the card's summary reads): a
 * named directory (the request or the stored config) keeps the flat
 * --local-dir target; only when neither names one does the hub-cache layout
 * apply, based on the hub cache root (the hf CLI's own download home, which
 * resolves its own snapshot destination), so a download never materializes
 * a snapshot-directory or hub-root override into the config.
 */
function resolveDownloadTarget(localInfer, requestDirectory, stored) {
    if (isModelDirectoryOverridden(requestDirectory)) {
        return { directory: requestDirectory, useHubCache: false };
    }
    if (isModelDirectoryOverridden(stored.config.modelDirectory)) {
        return { directory: stored.config.modelDirectory, useHubCache: false };
    }
    return { directory: localInfer.defaultModelDirectory(), useHubCache: true };
}
/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory through
 * resolveDownloadTarget, and runs the download through the service.
 */
export async function downloadFor(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const modelId = request.model ?? (typeof stored.config.model === 'string' ? stored.config.model : '');
    const entry = defaultModelFor(engineId, modelId);
    if (entry === undefined) {
        throw new RouteError(404, `no default model is registered for "${engineId}/${modelId}"`);
    }
    const { directory, useHubCache } = resolveDownloadTarget(localInfer, request.directory, stored);
    return localInfer.downloadModel(entry, directory, { useHubCache });
}
/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory through resolveDownloadTarget, and
 * runs the download through the service.
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
    const { directory, useHubCache } = resolveDownloadTarget(localInfer, request.directory, stored);
    return localInfer.downloadChatTemplate(template, directory, { useHubCache });
}
//# sourceMappingURL=hf.js.map
