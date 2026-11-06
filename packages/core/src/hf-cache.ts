/**
 * Hf cache directory resolution: the default Hugging Face cache locations the
 * plugin's model and dataset downloads target. The precedence mirrors
 * huggingface_hub, so a download through the plugin lands where the hf CLI
 * and the Python libraries look: the per-store override wins, then the
 * HF_HOME global, then the platform default under the user home.
 * @module dsh-plugin-local-infer/core/hf-cache
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { hfDownloadResultDirectory } from './infer-cache.ts'
import type { ModelDownloadSource } from './models.ts'
import { isModelDirectoryOverridden, repoIdFromUrl } from './models.ts'

// The platform default HF home: ~/.cache/huggingface on Linux and macOS,
// C:\Users\<user>\.cache\huggingface on Windows. homedir() names the right
// base on every host.
function defaultHfHome(): string {
  return join(homedir(), '.cache', 'huggingface')
}

// A set env var that is blank (an empty string or whitespace only) reads as
// unset, the same rule huggingface_hub applies.
function envValue(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * hfHubCacheDirectory resolves the Hugging Face hub cache directory (models,
 * tokenizers, and hub spaces): HF_HUB_CACHE when set, else $HF_HOME/hub when
 * HF_HOME is set, else ~/.cache/huggingface/hub.
 */
export function hfHubCacheDirectory(): string {
  const hub = envValue('HF_HUB_CACHE')
  if (hub !== undefined) return hub
  const home = envValue('HF_HOME')
  return join(home ?? defaultHfHome(), 'hub')
}

/**
 * ModelDownloadTarget is the resolved download target for one model
 * directory: the base directory the hf CLI writes into and whether the
 * hub-cache layout (no --local-dir, the models--{ns}--{name} directories)
 * applies. The rule is the single source the adapters' deploy steps and the
 * download routes share: it reads the raw model-directory field through the
 * shared override predicate (isModelDirectoryOverridden), so a named
 * directory keeps the flat --local-dir target and an absent or blank one
 * downloads into the hub cache.
 */
export interface ModelDownloadTarget {
  baseDir: string
  useHubCache: boolean
}

/**
 * modelDownloadTarget resolves the download target for a raw model-directory
 * field: a named directory is the flat --local-dir base, and an absent or
 * blank directory is the hub-cache layout (the hf CLI writes its
 * models--{ns}--{name} directories into the hub cache root). `hubCache` is
 * the hub cache root to fall back onto; the default reads the core
 * resolution, and a caller that owns the value (the service seam, which also
 * creates the directory when absent) passes it.
 */
export function modelDownloadTarget(
  modelDirectory: unknown,
  hubCache = hfHubCacheDirectory(),
): ModelDownloadTarget {
  const useHubCache = !isModelDirectoryOverridden(modelDirectory)
  return { baseDir: useHubCache ? hubCache : modelDirectory, useHubCache }
}

/**
 * ModelDirectoryResolution is the full model-directory read for one raw
 * config field: the ModelDownloadTarget (the download and presence-join base
 * plus the layout flag) extended with the concrete `directory` a read shows
 * and lists. Under the hub-cache layout that directory is the hf download
 * result: the snapshot holding the selected artifact when it is cached, else
 * the hub cache root.
 */
export interface ModelDirectoryResolution extends ModelDownloadTarget {
  directory: string
}

/**
 * resolveModelDirectory resolves the model directory a read names for a
 * model: the raw field's override when it names a path; else, when the
 * selected entry resolves and its artifact is already in the hub cache, the
 * hf download result (the snapshot directory holding it); else the hub cache
 * root, the base the hf CLI downloads into. The result is derived on every
 * read and never written back into the config, so a default install never
 * materializes a fake `modelDirectory` override. `hubCache` is the hub cache
 * root to resolve over; the service seam names it when it owns the value (it
 * also creates the directory when absent), and the default reads the core
 * resolution.
 */
export function resolveModelDirectory(
  modelDirectory: unknown,
  source?: ModelDownloadSource,
  hubCache = hfHubCacheDirectory(),
): ModelDirectoryResolution {
  const target = modelDownloadTarget(modelDirectory, hubCache)
  if (!target.useHubCache) return { ...target, directory: target.baseDir }
  const snapshot =
    source === undefined
      ? null
      : hfDownloadResultDirectory(hubCache, repoIdFromUrl(source.url), source.file ?? '')
  return { ...target, directory: snapshot ?? hubCache }
}

/**
 * hfDatasetsCacheDirectory resolves the Hugging Face datasets cache
 * directory: HF_DATASETS_CACHE when set, else $HF_HOME/datasets when HF_HOME
 * is set, else ~/.cache/huggingface/datasets.
 */
export function hfDatasetsCacheDirectory(): string {
  const datasets = envValue('HF_DATASETS_CACHE')
  if (datasets !== undefined) return datasets
  const home = envValue('HF_HOME')
  return join(home ?? defaultHfHome(), 'datasets')
}
