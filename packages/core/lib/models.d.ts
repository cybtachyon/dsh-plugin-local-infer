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
 * modelArtifactPath is the path the presence check looks for in the model
 * directory: the entry's artifact file when it names one, else the repo-name
 * directory a whole-repo download leaves behind.
 */
export declare function modelArtifactPath(entry: DefaultModel, directory: string): string;
/**
 * hfDownloadCommand renders the hf CLI download for one default model: the
 * repo, the artifact file when the entry names one, and the `--local-dir`
 * target. The string is the single source the download route runs and the
 * card shows beside its Download button.
 */
export declare function hfDownloadCommand(entry: DefaultModel, directory: string): string;
/**
 * The chat template file the hf CLI pulls into the model directory. The
 * NInfer deploy step and the template download route both target this name, so
 * a template the user selects lands where the engine reads it.
 */
export declare const CHAT_TEMPLATE_FILE = "chat_template.jinja";
/**
 * hfChatTemplateCommand renders the hf CLI download for one chat template repo
 * reference into the model directory: the repo, the template file, and the
 * `--local-dir` target. The string is the single source the template download
 * route runs and the card shows beside its Download button and in the System
 * dependencies box when the auto-download is unavailable.
 */
export declare function hfChatTemplateCommand(repo: string, directory: string): string;
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
//# sourceMappingURL=models.d.ts.map