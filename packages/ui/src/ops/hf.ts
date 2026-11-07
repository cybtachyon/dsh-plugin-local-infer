/**
 * The hf CLI download operations: downloadFor runs the download for a default
 * model, and chatTemplateDownloadFor pulls a selected chat template into the
 * model directory. Both resolve the directory through resolveDownloadTarget
 * (the request, the stored config, and the hub cache root in that order,
 * through the shared override rule), so the hub-cache layout rule has one
 * home across the download routes and the card.
 * @module dsh-plugin-local-infer/ui/ops/hf
 */

import type { DownloadResult, LocalInferService } from 'dsh-plugin-local-infer/service'
import type { ModelDownloadTarget } from '../../../core/lib/index.js'
import { isModelDirectoryOverridden, modelDownloadTarget } from '../../../core/lib/index.js'
import { runLogKey } from '../../../service/lib/index.js'
import { defaultModelFor } from '../../../providers/lib/index.js'
import { readConfig } from '../config.ts'
import type { StoredConfig } from '../config.ts'
import { CANCELED_LINE, DOWNLOAD_RUN_SEED, persistProcessLog } from './logs.ts'
import { RouteError } from '../route.ts'
import type { ChatTemplateDownloadRequest, DownloadRequest } from '../request.ts'
import { isHfRepoReference } from '../viewmodels/summaryHelpers.ts'

/**
 * resolveDownloadTarget resolves the directory a download route targets: the
 * request's directory, the stored config's model directory, and the hub
 * cache root, in that order. The first named directory wins (the shared
 * override predicate), then the shared modelDownloadTarget rule decides the
 * layout: a named directory keeps the flat --local-dir target; only when
 * neither names one does the hub-cache layout apply, based on the hub cache
 * root (the service seam: the hf CLI's own download home, which resolves its
 * own snapshot destination and creates the directory when absent), so a
 * download never materializes a snapshot-directory or hub-root override into
 * the config.
 */
function resolveDownloadTarget(
  localInfer: LocalInferService,
  requestDirectory: string | undefined,
  stored: StoredConfig,
): ModelDownloadTarget {
  const named = isModelDirectoryOverridden(requestDirectory)
    ? requestDirectory
    : stored.config.modelDirectory
  return modelDownloadTarget(named, localInfer.defaultModelDirectory())
}

/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory through
 * resolveDownloadTarget, and runs the download through the service. The run
 * brackets one live hub run under the runLogKey rule keyed on the entry's
 * engine and model (a draft falls back to the engine id): the seed is the
 * "Downloading..." separator, the hf CLI's streamed chunks append as they
 * land, and the settled completion or failure line reaches the hub and the
 * persisted run from one text before the run ends. The optional signal is
 * the card's cancel (the download route's response-close abort, the Get and
 * launch routes' rule): an abort interrupts the in-flight hf child (SIGINT,
 * then SIGTERM) and the run carries the shared "Canceled" line, live and
 * persisted.
 */
export async function downloadFor(
  localInfer: LocalInferService,
  request: DownloadRequest,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const stored = readConfig()
  const engineId = request.engine ?? stored.engine
  const modelId =
    request.model ?? (typeof stored.config.model === 'string' ? stored.config.model : '')
  const entry = defaultModelFor(engineId, modelId)
  if (entry === undefined) {
    throw new RouteError(404, `no default model is registered for "${engineId}/${modelId}"`)
  }
  const { baseDir, useHubCache } = resolveDownloadTarget(localInfer, request.directory, stored)
  // The key rule prices the model this download fetches, so the run lands on
  // the stored entry for that engine and model, not the draft's.
  const runKey = runLogKey(stored.providers, engineId, undefined, {
    ...stored.config,
    ...(modelId === '' ? {} : { model: modelId }),
  })
  localInfer.beginRun(runKey, DOWNLOAD_RUN_SEED)
  try {
    const result = await localInfer.downloadModel(entry, baseDir, {
      useHubCache,
      ...(signal !== undefined ? { signal } : {}),
      onChunk: (chunk) => {
        localInfer.appendRunLog(runKey, chunk)
      },
    })
    // The settle line reads the same in the live run and the persisted one:
    // the "Downloading..." separator leads the stored run so the Logs
    // section and the log file read the download as a fresh process section.
    // A cancel appends the shared "Canceled" line, the Get and launch
    // routes' mark, so the run reads as canceled wherever it is read.
    const line = result.ok
      ? 'download complete\n'
      : `!! download failed${result.detail !== undefined ? `: ${result.detail}` : ''}\n`
    const settled = signal?.aborted === true ? `${line}${CANCELED_LINE}` : line
    localInfer.appendRunLog(runKey, settled)
    persistProcessLog(`${DOWNLOAD_RUN_SEED}${settled}`)
    return result
  } finally {
    localInfer.endRun(runKey)
  }
}

/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory through resolveDownloadTarget, and
 * runs the download through the service. The run brackets one live hub run
 * under the "Downloading..." seed and the runLogKey rule (the stored entry
 * matching the engine and model, else the engine id): the hf CLI's streamed
 * chunks append as they land, and the run ends at settle. The optional
 * signal is the card's cancel (the chat-template route's response-close
 * abort, the Get and launch routes' rule): an abort interrupts the in-flight
 * hf child and the live run carries the shared "Canceled" line.
 */
export async function chatTemplateDownloadFor(
  localInfer: LocalInferService,
  request: ChatTemplateDownloadRequest,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const stored = readConfig()
  let template = typeof request.template === 'string' ? request.template : ''
  if (template.trim() === '') {
    template = typeof stored.config.chatTemplate === 'string' ? stored.config.chatTemplate : ''
  }
  if (!isHfRepoReference(template)) {
    throw new RouteError(
      400,
      `the chat template must be an HF repo reference, got "${template || '(none)'}"`,
    )
  }
  const { baseDir, useHubCache } = resolveDownloadTarget(localInfer, request.directory, stored)
  const runKey = runLogKey(
    stored.providers,
    request.engine ?? stored.engine,
    undefined,
    stored.config,
  )
  localInfer.beginRun(runKey, DOWNLOAD_RUN_SEED)
  try {
    const result = await localInfer.downloadChatTemplate(template, baseDir, {
      useHubCache,
      ...(signal !== undefined ? { signal } : {}),
      onChunk: (chunk) => {
        localInfer.appendRunLog(runKey, chunk)
      },
    })
    // A cancel marks the live run canceled; the template pull's outcome
    // rides the card's template cell, not the persisted run, so no persist.
    if (signal?.aborted === true) {
      localInfer.appendRunLog(runKey, CANCELED_LINE)
    }
    return result
  } finally {
    localInfer.endRun(runKey)
  }
}
