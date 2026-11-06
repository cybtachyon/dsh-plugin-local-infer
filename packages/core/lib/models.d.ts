/**
 * DefaultModel is one entry of the plugin's default model list: the engine it
 * belongs to, the registry key the config `model` field carries, the display
 * label the card's Model dropdown shows, the Hugging Face repo URL the model
 * download pulls from, and the optional artifact file the download targets and
 * the presence check looks for in the model directory. An entry without a
 * `file` downloads the whole repo, and the presence check looks for the
 * repo-name directory the download leaves behind.
 */
export interface DefaultModel {
    engineId: string;
    modelId: string;
    label: string;
    url: string;
    file?: string;
}
/**
 * ModelDownloadSource is the half of a DefaultModel the presence check, the
 * hf CLI command, and the hub-cache lookup read: the Hugging Face repo URL
 * and the optional artifact file. A full list entry satisfies it, and an
 * adapter that only resolves the download pair composes just these fields
 * instead of restating the entry's inert registry data.
 */
export type ModelDownloadSource = Pick<DefaultModel, 'url' | 'file'>;
/**
 * repoIdFromUrl turns a Hugging Face repo URL into the `owner/name` repo id
 * the hf CLI takes. A URL with no owner/name pair reads as an empty id, which
 * the command builder degrades to a repo-less download the caller rejects.
 */
export declare function repoIdFromUrl(url: string): string;
/**
 * repoNameFromUrl is the last path segment of a Hugging Face repo URL: the
 * directory name a whole-repo `hf download --local-dir` leaves in the model
 * directory.
 */
export declare function repoNameFromUrl(url: string): string;
/**
 * hubCacheModelDirectory is the per-model directory the hf CLI creates in the
 * hub cache for one repo id: `models--{namespace}--{name}`. A repo id without
 * an owner/name pair reads as an empty directory name, which the callers
 * handle as an absent model.
 */
export declare function hubCacheModelDirectory(repoId: string): string;
/**
 * isModelDirectoryOverridden reports whether a model directory field (the
 * config's or a download request's) names a path (a non-blank string), the
 * one rule every download route and view model shares to decide the layout:
 * a named directory targets that directory flat (`--local-dir`), an unnamed
 * one takes the hub-cache layout (no `--local-dir`, the
 * `models--{ns}--{name}` directories the hf CLI writes into the hub cache).
 * The predicate form lets callers narrow the field to a string without
 * restating the blank check.
 */
export declare function isModelDirectoryOverridden(modelDirectory: unknown): modelDirectory is string;
/**
 * modelArtifactPath is the path a model download's artifact lands at in the
 * model directory: the entry's artifact file when it names one, else the
 * repo-name directory a whole-repo download leaves behind. With the hub-cache
 * layout (`useHubCache`), it resolves into the per-model cache directory's
 * `blobs` folder, the content-addressed store the hf CLI writes without
 * `--local-dir`; the `directory` is then the hub cache root, not the per-model
 * folder. Card-facing presence checks resolve the deterministic snapshot
 * instead (modelArtifactPresent); this coarse form stays the engines' deploy
 * re-fetch gate.
 */
export declare function modelArtifactPath(entry: ModelDownloadSource, directory: string, useHubCache?: boolean): string;
/**
 * hfDownloadFileCommand renders the hf CLI download for one repo and file
 * pair: the repo, the file (omitted when blank, a whole-repo download), the
 * `--local-dir` target when the hub-cache layout does not apply, and the
 * `--format human` flag. The flag overrides the non-TTY default (`auto` picks
 * `agent`, which prints no progress) so the hf CLI prints tqdm progress
 * lines to stderr, which the progress streaming tasks consume. The string is
 * the single source every hf download command renders through: the model and
 * chat-template builders below, and the Infernix extra-download commands the
 * Get step streams.
 */
export declare function hfDownloadFileCommand(repo: string, file: string, directory: string, useHubCache?: boolean): string;
/**
 * hfDownloadCommand renders the hf CLI download for one model download
 * source: the repo, the artifact file when the entry names one, and the
 * `--local-dir` target. With the hub-cache layout (`useHubCache`), the `--local-dir` is
 * dropped so the hf CLI writes into the hub cache's `models--{ns}--{name}`
 * directory (the content-addressed `blobs/` plus the `snapshots/`). The
 * string is the single source the download route runs and the card shows
 * beside its Download button, rendered through hfDownloadFileCommand.
 */
export declare function hfDownloadCommand(entry: ModelDownloadSource, directory: string, useHubCache?: boolean): string;
/**
 * The chat template file the hf CLI pulls into the model directory. The
 * NInfer deploy step and the template download route both target this name, so
 * a template the user selects lands where the engine reads it.
 */
export declare const CHAT_TEMPLATE_FILE = "chat_template.jinja";
/**
 * hfChatTemplateCommand renders the hf CLI download for one chat template repo
 * reference into the model directory: the repo, the template file, and the
 * `--local-dir` target. With the hub-cache layout (`useHubCache`), the
 * `--local-dir` is dropped so the template lands in the hub cache's
 * `models--{ns}--{name}` directory. The string is the single source the
 * template download route runs and the card shows beside its Download button
 * and in the System dependencies box when the auto-download is unavailable,
 * rendered through hfDownloadFileCommand.
 */
export declare function hfChatTemplateCommand(repo: string, directory: string, useHubCache?: boolean): string;
/**
 * chatTemplateArtifactPath is the path the flat-layout chat-template presence
 * check looks for: the template file joined onto the model directory. The
 * hub-cache layout resolves through chatTemplatePresent instead (the
 * deterministic snapshot pick), not through this join.
 */
export declare function chatTemplateArtifactPath(directory: string): string;
/**
 * modelArtifactPresent reports whether a model download source's artifact is
 * on disk. With the hub-cache layout it resolves the deterministic hub-cache
 * snapshot holding the file (the same pick the model-directory display uses),
 * so a `blobs` folder left by any download never reads as present on its
 * own; a blank `file` (a whole-repo download) reads the repo's snapshot
 * directories. With the flat layout it checks the artifact path joined onto
 * the base directory. `baseDir` is the hub cache root under the cache layout,
 * the flat override otherwise.
 */
export declare function modelArtifactPresent(entry: ModelDownloadSource, baseDir: string, useHubCache?: boolean): boolean;
/**
 * chatTemplatePresent reports whether a chat template repo's template file is
 * on disk: the deterministic hub-cache snapshot pick under the hub-cache
 * layout (a per-repo `snapshots` folder alone never reads as present), the
 * flat file join otherwise. `baseDir` follows the modelArtifactPresent rule.
 */
export declare function chatTemplatePresent(repo: string, baseDir: string, useHubCache?: boolean): boolean;
/**
 * hubCacheSnapshotFilePath resolves the concrete file path of one file in the
 * hub cache's snapshots, matching what the hf CLI treats as the active
 * revision: the commit recorded in `refs/main` wins when its directory under
 * `models--{ns}--{name}/snapshots/` holds the file; otherwise the snapshot
 * with the newest mtime wins, covering a repo with no ref and a ref naming a
 * commit that lacks the file. Ties break on readdir order. Returns null when
 * no snapshot holds the file (the file is not downloaded), which the caller
 * reads as absent. The `hubCache` is the hub cache root.
 */
export declare function hubCacheSnapshotFilePath(hubCache: string, repoId: string, file: string): string | null;
/**
 * ModelDirectoryEntry is one top-level entry of a model directory listing:
 * the entry name, whether it is a directory, and for directories whether the
 * entry holds a `.safetensors` weight file, the marker of a usable Hugging
 * Face model repo the Hyper-Qwen engine consumes.
 */
export interface ModelDirectoryEntry {
    name: string;
    isDirectory: boolean;
    hasSafetensors?: boolean;
}
/**
 * modelEntriesForEngine filters a model directory listing down to the model
 * entries the engine's Model dropdown offers: NInfer takes `.ninfer`
 * artifacts, Infernix takes `.ninfer` artifacts and its own `.infernix`
 * files, llama.cpp takes `.gguf` files, and Hyper-Qwen takes the repo
 * directories that hold a `.safetensors` weight file. Every other engine
 * (Strata) offers nothing, matching its empty default list. The result is
 * sorted, so the dropdown order is stable across summary fetches.
 */
export declare function modelEntriesForEngine(entries: readonly ModelDirectoryEntry[], engineId: string): string[];
/**
 * ModelCacheEntry is one `models--*` directory in the hub cache: the repo id
 * the directory names (the `{namespace}/{name}` decoded from the
 * `models--{ns}--{name}` form) and the artifact file names the snapshots hold
 * (the union across every commit), the data the per-engine cache scan filters.
 */
export interface ModelCacheEntry {
    repoId: string;
    files: string[];
}
/**
 * modelCacheEntriesForEngine filters the hub cache's `models--*` directories
 * down to the models the engine's Model dropdown offers, by the artifact types
 * each engine serves: Basalt `.basalt`, NInfer `.ninfer`, Infernix
 * `.ninfer`/`.infernix`, llama.cpp `.gguf`, Hyper-Qwen a repo holding a
 * `.safetensors` weight file, and Strata `.gguf`/`.safetensors`. An engine with
 * no matching cached model lists none. The result is the repo ids the
 * dropdown shows, sorted for a stable order across summary fetches.
 */
export declare function modelCacheEntriesForEngine(entries: readonly ModelCacheEntry[], engineId: string): string[];
//# sourceMappingURL=models.d.ts.map
