/**
 * Infer cache directory resolution: the plugin-owned locations under the user
 * home where engine checkouts live and engine config files land. One module
 * owns every `~/.cache/dsh/infer` path so adapters, routes, and view models
 * consume these builders instead of restating the literal. Models stay
 * outside it: the hub cache remains the model download home.
 * @module dsh-plugin-local-infer/core/infer-cache
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hubCacheSnapshotFilePath } from "./models.js";
/**
 * dshInferCacheDirectory is the plugin's cache root:
 * `~/.cache/dsh/infer`. Engine checkouts and engine config files live under
 * it; model downloads do not.
 */
export function dshInferCacheDirectory() {
    return join(homedir(), '.cache', 'dsh', 'infer');
}
/**
 * dshEngineCacheDirectory is the default checkout home for one engine:
 * `~/.cache/dsh/infer/{engineId}` (e.g. `~/.cache/dsh/infer/basalt`). One
 * checkout per engine, never a subfolder of a model directory.
 */
export function dshEngineCacheDirectory(engineId) {
    return join(dshInferCacheDirectory(), engineId);
}
/**
 * dshConfigCacheDirectory is the default home for engine config files the
 * plugin writes: `~/.cache/dsh/infer/config`. Engines that require a
 * specific placement are the exception; every other config file lands here
 * (in a per-engine subdirectory, which the caller composes).
 */
export function dshConfigCacheDirectory() {
    return join(dshInferCacheDirectory(), 'config');
}
/**
 * hfDownloadResultDirectory is the directory the hf CLI's hub-cache download
 * of one repo file lands in: the snapshot directory under
 * `models--{ns}--{name}/snapshots/` that holds the artifact, resolved
 * through hubCacheSnapshotFilePath. Returns null when the artifact is not in
 * the cache, which the caller reads as "fall back to the hub cache root as
 * the download base". A blank `file` names no artifact (a whole-repo
 * download has no single snapshot directory to name), so it resolves to null
 * for the same fallback.
 */
export function hfDownloadResultDirectory(hubCache, repoId, file) {
    if (file === '')
        return null;
    const path = hubCacheSnapshotFilePath(hubCache, repoId, file);
    return path === null ? null : dirname(path);
}
//# sourceMappingURL=infer-cache.js.map
