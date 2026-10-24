/**
 * The small pure helpers the summary view model prices: the HF repo
 * reference check the chat-template status runs, the template display label,
 * and the model-value-to-registry-key map the estimator prices.
 * @module dsh-plugin-local-infer/ui/viewmodels/summaryHelpers
 */
import { CHAT_TEMPLATE_OPTIONS, defaultModelsForEngine } from '../../../providers/lib/index.js';
/**
 * isHfRepoReference reports whether a chat template value is a Hugging Face
 * repo reference (an owner/name pair) rather than a local path: it carries a
 * slash and does not start with one. Only repo references are auto-downloaded
 * into the model directory; a local path is used in place.
 */
export function isHfRepoReference(value) {
    return value !== '' && !value.startsWith('/') && value.includes('/');
}
/**
 * chatTemplateLabel resolves the display label for a chat template repo: the
 * preset's label when the repo is a shipped preset, else the repo itself.
 */
export function chatTemplateLabel(repo) {
    const preset = CHAT_TEMPLATE_OPTIONS.find((option) => option.value === repo);
    return preset?.label ?? repo;
}
/**
 * resolveModelRegistryId maps the card's model value onto the VramModel
 * registry key the estimator prices. The card's Model field carries either a
 * registry key (a default-model selection) or an artifact file name (a
 * directory-scan selection, e.g. a .ninfer file); the default list maps the
 * file name to the registry key the estimator knows, so a scanned model prices
 * a real VramModel rather than reading as not-measured. A value that is
 * already a registry key passes through, and a missing value falls back to
 * the engine's first default model.
 */
export function resolveModelRegistryId(engineId, model) {
    if (typeof model === 'string' && model !== '') {
        const entry = defaultModelsForEngine(engineId).find((candidate) => candidate.file === model);
        return entry?.modelId ?? model;
    }
    return defaultModelsForEngine(engineId)[0]?.modelId ?? engineId;
}
//# sourceMappingURL=summaryHelpers.js.map