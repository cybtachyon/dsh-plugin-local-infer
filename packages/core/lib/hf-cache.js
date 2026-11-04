/**
 * Hf cache directory resolution: the default Hugging Face cache locations the
 * plugin's model and dataset downloads target. The precedence mirrors
 * huggingface_hub, so a download through the plugin lands where the hf CLI
 * and the Python libraries look: the per-store override wins, then the
 * HF_HOME global, then the platform default under the user home.
 * @module dsh-plugin-local-infer/core/hf-cache
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
// The platform default HF home: ~/.cache/huggingface on Linux and macOS,
// C:\Users\<user>\.cache\huggingface on Windows. homedir() names the right
// base on every host.
function defaultHfHome() {
    return join(homedir(), '.cache', 'huggingface');
}
// A set env var that is blank (an empty string or whitespace only) reads as
// unset, the same rule huggingface_hub applies.
function envValue(name) {
    const value = process.env[name];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/**
 * hfHubCacheDirectory resolves the Hugging Face hub cache directory (models,
 * tokenizers, and hub spaces): HF_HUB_CACHE when set, else $HF_HOME/hub when
 * HF_HOME is set, else ~/.cache/huggingface/hub.
 */
export function hfHubCacheDirectory() {
    const hub = envValue('HF_HUB_CACHE');
    if (hub !== undefined)
        return hub;
    const home = envValue('HF_HOME');
    return join(home ?? defaultHfHome(), 'hub');
}
/**
 * hfDatasetsCacheDirectory resolves the Hugging Face datasets cache
 * directory: HF_DATASETS_CACHE when set, else $HF_HOME/datasets when HF_HOME
 * is set, else ~/.cache/huggingface/datasets.
 */
export function hfDatasetsCacheDirectory() {
    const datasets = envValue('HF_DATASETS_CACHE');
    if (datasets !== undefined)
        return datasets;
    const home = envValue('HF_HOME');
    return join(home ?? defaultHfHome(), 'datasets');
}
//# sourceMappingURL=hf-cache.js.map
