import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/**
 * repoIdFromUrl turns a Hugging Face repo URL into the `owner/name` repo id
 * the hf CLI takes. A URL with no owner/name pair reads as an empty id, which
 * the command builder degrades to a repo-less download the caller rejects.
 */
export function repoIdFromUrl(url) {
    const match = url.match(/huggingface\.co\/([^/\s]+)\/([^/\s]+)/);
    if (match === null || match[1] === undefined || match[2] === undefined)
        return '';
    return `${match[1]}/${match[2]}`;
}
/**
 * repoNameFromUrl is the last path segment of a Hugging Face repo URL: the
 * directory name a whole-repo `hf download --local-dir` leaves in the model
 * directory.
 */
export function repoNameFromUrl(url) {
    const repo = repoIdFromUrl(url);
    const slash = repo.lastIndexOf('/');
    return slash >= 0 ? repo.slice(slash + 1) : repo;
}
/**
 * hubCacheModelDirectory is the per-model directory the hf CLI creates in the
 * hub cache for one repo id: `models--{namespace}--{name}`. A repo id without
 * an owner/name pair reads as an empty directory name, which the callers
 * handle as an absent model.
 */
export function hubCacheModelDirectory(repoId) {
    const slash = repoId.lastIndexOf('/');
    if (slash <= 0)
        return '';
    return `models--${repoId.slice(0, slash)}--${repoId.slice(slash + 1)}`;
}
/**
 * isModelDirectoryOverridden reports whether a config's model directory field
 * names a path (a non-blank string), the rule that decides whether the hf
 * download targets that directory flat (`--local-dir`) or the hub-cache
 * layout (no `--local-dir`, the `models--{ns}--{name}` directories the hf CLI
 * writes into the hub cache).
 */
export function isModelDirectoryOverridden(modelDirectory) {
    return typeof modelDirectory === 'string' && modelDirectory.trim() !== '';
}
/**
 * modelArtifactPath is the path the presence check looks for in the model
 * directory: the entry's artifact file when it names one, else the repo-name
 * directory a whole-repo download leaves behind. With the hub-cache layout
 * (`useHubCache`), it resolves into the per-model cache directory's `blobs`
 * folder, the content-addressed store the hf CLI writes without `--local-dir`;
 * the `directory` is then the hub cache root, not the per-model folder.
 */
export function modelArtifactPath(entry, directory, useHubCache = false) {
    if (useHubCache) {
        const modelDir = hubCacheModelDirectory(repoIdFromUrl(entry.url));
        if (modelDir !== '')
            return join(directory, modelDir, 'blobs');
    }
    if (entry.file !== undefined && entry.file !== '') {
        return join(directory, entry.file);
    }
    return join(directory, repoNameFromUrl(entry.url));
}
/**
 * hfDownloadCommand renders the hf CLI download for one default model: the
 * repo, the artifact file when the entry names one, and the `--local-dir`
 * target. With the hub-cache layout (`useHubCache`), the `--local-dir` is
 * dropped so the hf CLI writes into the hub cache's `models--{ns}--{name}`
 * directory (the content-addressed `blobs/` plus the `snapshots/`). The string
 * is the single source the download route runs and the card shows beside its
 * Download button.
 */
export function hfDownloadCommand(entry, directory, useHubCache = false) {
    const repo = repoIdFromUrl(entry.url);
    const file = entry.file !== undefined && entry.file !== '' ? ` ${entry.file}` : '';
    if (useHubCache)
        return `hf download ${repo}${file}`;
    return `hf download ${repo}${file} --local-dir ${directory}`;
}
/**
 * The chat template file the hf CLI pulls into the model directory. The
 * NInfer deploy step and the template download route both target this name, so
 * a template the user selects lands where the engine reads it.
 */
export const CHAT_TEMPLATE_FILE = 'chat_template.jinja';
/**
 * hfChatTemplateCommand renders the hf CLI download for one chat template repo
 * reference into the model directory: the repo, the template file, and the
 * `--local-dir` target. With the hub-cache layout (`useHubCache`), the
 * `--local-dir` is dropped so the template lands in the hub cache's
 * `models--{ns}--{name}` directory. The string is the single source the
 * template download route runs and the card shows beside its Download button
 * and in the System dependencies box when the auto-download is unavailable.
 */
export function hfChatTemplateCommand(repo, directory, useHubCache = false) {
    if (useHubCache)
        return `hf download ${repo} ${CHAT_TEMPLATE_FILE}`;
    return `hf download ${repo} ${CHAT_TEMPLATE_FILE} --local-dir ${directory}`;
}
/**
 * chatTemplateArtifactPath is the path the chat-template presence check looks
 * for: the template file in the model directory, or with the hub-cache layout
 * (`useHubCache`) the per-model cache directory's `snapshots` folder, where
 * the hf CLI writes the template without `--local-dir`. The `directory` is the
 * hub cache root in the cache layout, not the per-model folder.
 */
export function chatTemplateArtifactPath(repo, directory, useHubCache = false) {
    if (useHubCache) {
        const modelDir = hubCacheModelDirectory(repo);
        if (modelDir !== '')
            return join(directory, modelDir, 'snapshots');
    }
    return join(directory, CHAT_TEMPLATE_FILE);
}
/**
 * hubCacheSnapshotFilePath resolves the concrete file path of one file in the
 * hub cache's snapshots: the first commit directory under
 * `models--{ns}--{name}/snapshots/` that holds the file. Returns null when no
 * snapshot holds it (the file is not downloaded), which the caller reads as
 * absent. The `hubCache` is the hub cache root.
 */
export function hubCacheSnapshotFilePath(hubCache, repoId, file) {
    const modelDir = hubCacheModelDirectory(repoId);
    if (modelDir === '')
        return null;
    const snapshots = join(hubCache, modelDir, 'snapshots');
    let commits;
    try {
        commits = readdirSync(snapshots);
    }
    catch {
        return null;
    }
    for (const commit of commits) {
        const path = join(snapshots, commit, file);
        if (existsSync(path))
            return path;
    }
    return null;
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
export function modelEntriesForEngine(entries, engineId) {
    let names;
    switch (engineId) {
        case 'ninfer':
            names = entries
                .filter((entry) => !entry.isDirectory && entry.name.endsWith('.ninfer'))
                .map((entry) => entry.name);
            break;
        case 'infernix':
            // Infernix loads NInfer artifacts unchanged plus its own `.infernix`
            // files, so the dropdown offers both extensions.
            names = entries
                .filter((entry) => !entry.isDirectory &&
                (entry.name.endsWith('.ninfer') || entry.name.endsWith('.infernix')))
                .map((entry) => entry.name);
            break;
        case 'llamacpp':
            names = entries
                .filter((entry) => !entry.isDirectory && entry.name.endsWith('.gguf'))
                .map((entry) => entry.name);
            break;
        case 'hyperqwen':
            names = entries
                .filter((entry) => entry.isDirectory && entry.hasSafetensors === true)
                .map((entry) => entry.name);
            break;
        default:
            names = [];
    }
    return names.sort();
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
export function modelCacheEntriesForEngine(entries, engineId) {
    const serves = (files) => {
        switch (engineId) {
            case 'basalt':
                return files.some((file) => file.endsWith('.basalt'));
            case 'ninfer':
                return files.some((file) => file.endsWith('.ninfer'));
            case 'infernix':
                return files.some((file) => file.endsWith('.ninfer') || file.endsWith('.infernix'));
            case 'llamacpp':
                return files.some((file) => file.endsWith('.gguf'));
            case 'hyperqwen':
                return files.some((file) => file.endsWith('.safetensors'));
            case 'strata':
                return files.some((file) => file.endsWith('.gguf') || file.endsWith('.safetensors'));
            default:
                return false;
        }
    };
    return entries
        .filter((entry) => serves(entry.files))
        .map((entry) => entry.repoId)
        .sort();
}
//# sourceMappingURL=models.js.map
