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
 * hfDatasetsCacheDirectory resolves the Hugging Face datasets cache
 * directory: HF_DATASETS_CACHE when set, else $HF_HOME/datasets when HF_HOME
 * is set, else ~/.cache/huggingface/datasets.
 */
export declare function hfDatasetsCacheDirectory(): string;
//# sourceMappingURL=hf-cache.d.ts.map
