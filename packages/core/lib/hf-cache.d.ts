/**
 * Hf cache directory resolution: the default Hugging Face cache locations the
 * plugin's model and dataset downloads target. The precedence mirrors
 * huggingface_hub, so a download through the plugin lands where the hf CLI
 * and the Python libraries look: the per-store override wins, then the
 * HF_HOME global, then the platform default under the user home.
 * @module dsh-plugin-local-infer/core/hf-cache
 */
/**
 * hfHubCacheDirectory resolves the Hugging Face hub cache directory (models,
 * tokenizers, and hub spaces): HF_HUB_CACHE when set, else $HF_HOME/hub when
 * HF_HOME is set, else ~/.cache/huggingface/hub.
 */
export declare function hfHubCacheDirectory(): string;
/**
 * ModelDownloadTarget is the resolved download target for one model
 * directory: the base directory the hf CLI writes into and whether the
 * hub-cache layout (no --local-dir, the models--{ns}--{name} directories)
 * applies. The rule is the single source the adapters' deploy steps and the
 * download routes share: a named model directory keeps the flat --local-dir
 * target, and the plugin default (an absent or blank directory) downloads
 * into the hub cache.
 */
export interface ModelDownloadTarget {
    baseDir: string;
    useHubCache: boolean;
}
/**
 * modelDownloadTarget resolves the download target for a model directory
 * field: a named directory is the flat --local-dir base, and an absent or
 * blank directory is the hub-cache layout (the hf CLI writes its
 * models--{ns}--{name} directories into the hub cache root).
 */
export declare function modelDownloadTarget(modelDirectory: string | undefined): ModelDownloadTarget;
/**
 * hfDatasetsCacheDirectory resolves the Hugging Face datasets cache
 * directory: HF_DATASETS_CACHE when set, else $HF_HOME/datasets when HF_HOME
 * is set, else ~/.cache/huggingface/datasets.
 */
export declare function hfDatasetsCacheDirectory(): string;
//# sourceMappingURL=hf-cache.d.ts.map
