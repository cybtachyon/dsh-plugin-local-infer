/**
 * The engine lifecycle operations: launchEngine runs the shared Get-steps
 * routine (idempotent) and then renders the plan the registered adapter
 * produces and runs the service's launch entry point (deploy, then the health
 * poll), preserving the Get-step logs in the persisted last-run logs;
 * stopEngine stops the exact container or process the launch started (a
 * re-adopted engine through the record's pid), and a failed stop persists a
 * note to the last-run logs and the log file; getEngine is a thin wrapper
 * over the shared Get-steps routine (deps, git sync, build, model download,
 * chat-template download). The launch record (the engine pid, start time,
 * launch arguments, and the DSH process pid that launched it) is what a DSH
 * restart re-links a surviving engine to its config:
 * relinkStoredProviders re-adopts surviving engines on mount and per summary
 * read, handleEngineDeath settles the stored state the moment an engine dies
 * outside the stop path, and persistLaunchLogs stores the captured output.
 * The platform-config registry sync keeps the service registry in step with
 * the stored config.
 * @module dsh-plugin-local-infer/ui/ops/engine
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type {
  Config,
  EnginePlatformConfig,
  LaunchPlan,
  LaunchStep,
  LifecycleHost,
} from 'dsh-plugin-local-infer/core'
import {
  LOG_TAIL_BYTES,
  formatLaunchCommand,
  launchRecordFromPlan,
  resolveLogPath,
} from '../../../core/lib/index.js'
import type {
  EngineDeathEvent,
  LaunchResult,
  LocalInferService,
} from 'dsh-plugin-local-infer/service'
import { nodeLifecycleHost } from '../../../providers/lib/index.js'
import type {
  StoredConfig,
  StoredPlatformConfig,
  StoredProviderConfig,
} from '../config.ts'
import { readConfig, writeStored } from '../config.ts'
import { persistProcessLog } from './logs.ts'
import { resolveEngineDirectory, runGetSteps } from './get-steps.ts'
import { RouteError } from '../route.ts'
import type { GetRequest, LaunchRequest } from '../request.ts'

/**
 * CANCELED_LINE is the "Canceled" line a client-disconnect cancel appends to
 * the persisted run, so the Logs section and the log file read the run as
 * canceled, the same line the card writes to its Logs buffer on the Cancel.
 */
export const CANCELED_LINE = '--- Canceled\n'

/**
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
export function resolveAdapter(localInfer: LocalInferService, engineId: string) {
  const adapter = localInfer.registeredEngines().find((engine) => engine.id === engineId)
  if (adapter === undefined) {
    throw new RouteError(404, `no engine adapter is registered for "${engineId}"`)
  }
  return adapter
}

/**
 * launchCommandNote renders the plan's child-process launch line for the
 * card's Logs section: the core formatter's command under a [local-infer]
 * launch prefix, newline-terminated. A plan that names no command (a bare
 * docker plan with no argv) has no note, and the run logs stay as they are.
 */
function launchCommandNote(plan: LaunchPlan): string | undefined {
  const command = formatLaunchCommand(plan)
  if (command === undefined) return undefined
  return `[local-infer] launch: ${command}\n`
}

/**
 * applyComposeArgs seeds a compose plan's compose arguments from the stored
 * platform config (the card's docker-tag field for a compose engine, e.g.
 * `--profile single`), so the up line the deploy runs and the down line the
 * stop runs both select the profile the user named. A compose plan with no
 * stored docker-tag keeps the engine's default profile; a non-compose plan is
 * untouched.
 */
function applyComposeArgs(
  plan: LaunchPlan,
  localInfer: LocalInferService,
  engineId: string,
): void {
  if (plan.kind !== 'compose') return
  const platform = localInfer.enginePlatformConfig(engineId)
  if (platform?.dockerTag !== undefined) {
    plan.composeArgs = platform.dockerTag
  }
}

/**
 * persistStoredLogs overwrites the stored last-run logs (the card's Logs
 * section shows them after a reload) and leaves every other stored field as
 * the launch reads it.
 */
function persistStoredLogs(logs: string): void {
  const stored = readConfig()
  writeStored(stored, { lastLogs: logs })
}

/**
 * resolveStoredRequest resolves a route request's engine and config against
 * the stored config: the request's fields win, and an absent field falls back
 * to the stored value, the same rule every route applies.
 */
function resolveStoredRequest(
  request: { engine?: string; config?: Config },
): { stored: StoredConfig; engineId: string; config: Config } {
  const stored = readConfig()
  return {
    stored,
    engineId: request.engine ?? stored.engine,
    config: request.config ?? stored.config,
  }
}

/**
 * registerLaunchPlatform registers the request's platform override (the
 * card's unsaved Engine Directory / Engine Fork edits) with the service
 * registry, and returns the effective platform entry the Get steps and the
 * deploy step read. A request with no Engine Directory override falls back
 * to the per-engine folder inside the model directory, so the deploy step
 * resolves a relative launch path (the NInfer Windows build tree) against a
 * real checkout; the fallback is registered so the service's launch reads
 * it, and a stored entry that already names a directory is left as-is. An
 * absent request platform keeps the stored entry, which the save route and
 * route registration already synced.
 */
function registerLaunchPlatform(
  localInfer: LocalInferService,
  request: { platform?: StoredPlatformConfig },
  stored: StoredConfig,
  engineId: string,
  config: Config,
): StoredPlatformConfig | undefined {
  if (request.platform !== undefined) {
    setPlatformConfig(localInfer, engineId, request.platform)
  }
  const platform = request.platform ?? stored.platform[engineId]
  if (platform?.engineDirectory === undefined || platform.engineDirectory.trim() === '') {
    const engineDirectory = resolveEngineDirectory(localInfer, config, engineId, platform)
    setPlatformConfig(localInfer, engineId, { ...platform, engineDirectory })
  }
  return platform
}

/**
 * launchEngine runs the shared Get-steps routine (idempotent: deps, git sync,
 * build, model download, chat-template download, each skipped when already
 * satisfied) and then renders the plan the registered adapter produces for
 * the config and the detected hardware, and runs the service's launch entry
 * point (deploy, then the health poll). The detail the launch returns names
 * the broken step when the engine does not come up. The launch line (the
 * engine binary and its arguments) leads the engine output in the run logs
 * the card's Logs section and the log file carry, and the Get-step output the
 * launch ran leads it, so a broken setup diagnoses against the exact steps
 * and child process the launch started, and the Get logs are preserved, not
 * wiped, by the launch's persistence. The launch step persists the
 * launch record (the engine pid, start time, launch arguments, and the DSH
 * process pid that launched it) on the request's provider entry, so a DSH
 * restart can re-link a surviving engine to its config. The optional signal
 * is the card's cancel: an abort interrupts the in-flight Get-step download
 * child, and the persisted run carries a "Canceled" line. The optional
 * onChunk is the hf download's raw stderr progress sink: the download runner
 * hands each streamed chunk to it as it lands, so a launch that runs the Get
 * steps streams the download progress the same way a Get does.
 */
export async function launchEngine(
  localInfer: LocalInferService,
  request: LaunchRequest,
  onProgress?: (step: LaunchStep) => void,
  host: LifecycleHost = nodeLifecycleHost,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<LaunchResult> {
  const { stored, engineId, config } = resolveStoredRequest(request)
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const platform = registerLaunchPlatform(localInfer, request, stored, engineId, config)
  // The prereqs phase: the system-dependency install the Get-steps routine
  // runs. It runs only while the Play/Run trust gate is on, the same rule the
  // Get step applies. The card's button reads "Prereqs..." for this phase, so
  // the phase is reported only while an install actually runs (the gate on),
  // not when the deps are already satisfied and the phase is skipped.
  if (stored.allowRunDeps === true) {
    onProgress?.('prereqs')
  }
  // The Get steps (deps, git sync, build, model download, chat-template
  // download) run idempotently before the launch plan renders, so a launch
  // never reads a missing checkout, binary, model, or template. The Auto
  // Rebuild checkbox off skips the sync and build steps, the same rule the
  // adapter's deploy step applies.
  let getLogs = ''
  const get = await runGetSteps(
    localInfer,
    {
      engineId,
      config,
      ...(platform !== undefined ? { platform } : {}),
      allowRunDeps: stored.allowRunDeps,
      ...(request.autoRebuild !== undefined ? { autoRebuild: request.autoRebuild } : {}),
      host,
      ...(signal !== undefined ? { signal } : {}),
      ...(onChunk !== undefined ? { onChunk } : {}),
    },
    (chunk) => {
      getLogs += chunk
    },
  )
  const plan = adapter.renderLaunch(config, hardware)
  if (!get.ok) {
    // A Get step that failed aborts the launch before the deploy starts, and
    // the persisted run carries the Get-step output that named the broken
    // step, so the Logs section diagnoses it after a reload. A cancel that
    // landed while the Get steps ran (the card's provider-form Cancel closed
    // the stream) adds the "Canceled" line, so the run reads as canceled.
    const result: LaunchResult = {
      plan,
      healthy: false,
      detail: get.detail ?? 'a Get step failed',
    }
    persistLaunchOutcome(
      result,
      engineId,
      config,
      request.providerId,
      signal?.aborted === true ? getLogs + CANCELED_LINE : getLogs,
    )
    return result
  }
  applyComposeArgs(plan, localInfer, engineId)
  const commandNote = launchCommandNote(plan)
  if (commandNote !== undefined) {
    // Persist before the deploy starts: a slow or hung launch keeps the Get
    // steps and the command readable in the Logs section across a card
    // reload, where the engine output has not landed yet.
    persistStoredLogs(getLogs + commandNote)
  }
  // The trust gate and the auto-rebuild flag ride into the deploy step, which
  // reads them to decide whether a rebuild's missing-binary symlink into
  // /usr/local/bin runs (on) or is written to the card's Logs section (off),
  // and whether the deploy's own git sync (fetch, rebase, rebuild) runs at
  // all.
  const result = await localInfer.launch(
    plan,
    {
      ...(onProgress !== undefined ? { onProgress } : {}),
      allowRunDeps: stored.allowRunDeps,
      ...(request.autoRebuild !== undefined ? { autoRebuild: request.autoRebuild } : {}),
    },
  )
  // A cancel that landed after the Get steps (the card's provider-form Cancel
  // closed the stream during the deploy or health poll) adds the "Canceled"
  // line, so the persisted run reads as canceled.
  composeLaunchLogs(result, getLogs, commandNote, signal?.aborted === true)
  persistLaunchOutcome(result, engineId, config, request.providerId, getLogs)
  return result
}

/**
 * composeLaunchLogs orders a launch's run logs: the Get-step output the
 * launch ran leads, the deploy step's build output follows it, the launch
 * command note follows that (after a successful build, or a direct launch
 * with no build), and the engine's runtime output comes last. The deploy
 * step's buildLogs field is folded into the ordered text and dropped, so the
 * result carries the ordered run in its logs field. A cancel that landed
 * after the Get steps appends the "Canceled" line, so the persisted run reads
 * as canceled.
 */
function composeLaunchLogs(
  result: LaunchResult,
  getLogs: string,
  commandNote: string | undefined,
  canceled: boolean,
): void {
  const buildLogs = result.buildLogs ?? ''
  const engineLogs = result.logs ?? ''
  result.logs = getLogs + buildLogs + (commandNote ?? '') + engineLogs
  if (result.buildLogs !== undefined) {
    delete result.buildLogs
  }
  if (canceled) {
    result.logs += CANCELED_LINE
  }
}

/**
 * persistLaunchOutcome persists a settled launch: the run logs to the stored
 * last-run logs and the log file (the Get-step output the launch ran leads),
 * and the launch record on the target provider entry, so a DSH restart can
 * re-link a surviving engine to its config.
 */
function persistLaunchOutcome(
  result: LaunchResult,
  engineId: string,
  config: Config,
  providerId: string | undefined,
  getLogs: string,
): void {
  persistLaunchLogs(result, engineId, config, getLogs)
  persistLaunchRecord(result, engineId, config, providerId)
}

/**
 * findLaunchTarget resolves the stored provider entry a launch or stop
 * targets: the entry the request names by id, or (an id the card does not
 * send, a launch of the active config) the stored entry with the same engine
 * and model. A launch with no resolvable entry persists no record, which
 * reads as "no provider config to re-link" after a restart.
 */
function findLaunchTarget(
  stored: StoredConfig,
  engineId: string,
  providerId: string | undefined,
  config: Config,
): StoredProviderConfig | undefined {
  if (providerId !== undefined) {
    const byId = stored.providers.find((entry) => entry.id === providerId)
    if (byId !== undefined) return byId
  }
  const model = typeof config.model === 'string' ? config.model : undefined
  if (model === undefined) return undefined
  return stored.providers.find(
    (entry) =>
      entry.engine === engineId &&
      (typeof entry.config.model === 'string' ? entry.config.model : undefined) === model,
  )
}

/**
 * persistLaunchRecord stores a launch's record on the target provider entry:
 * the engine pid the deploy step started, the start time, the plan's argv,
 * the DSH process pid the launch ran under (only when it identified as DSH),
 * and the previous-pid list the re-link rule prices (the entry's own list
 * plus the current DSH pid, capped by the core builder). A launch whose
 * deploy started no tracked process (a compose up) persists nothing, and a
 * launch with no resolvable entry persists nothing.
 */
function persistLaunchRecord(
  result: LaunchResult,
  engineId: string,
  config: Config,
  providerId: string | undefined,
): void {
  if (result.pid === undefined) return
  const stored = readConfig()
  const target = findLaunchTarget(stored, engineId, providerId, config)
  if (target === undefined) return
  const record = launchRecordFromPlan(
    result.plan,
    result.pid,
    result.parentPid,
    target.launch?.previousPids ?? [],
  )
  const providers = stored.providers.map((entry) =>
    entry.id === target.id ? { ...entry, launch: record } : entry,
  )
  writeStored(stored, { providers })
}

/**
 * clearLaunchRecord removes the target provider entry's launch record (the
 * engine pid and the previous-pid list with it), so a stopped engine's pid
 * cannot be re-linked to its config by a recycled pid. A stop with no
 * resolvable entry, or an entry that carries no record, is a no-op.
 */
function clearLaunchRecord(
  engineId: string,
  config: Config,
  providerId: string | undefined,
): void {
  const stored = readConfig()
  const target = findLaunchTarget(stored, engineId, providerId, config)
  if (target === undefined || target.launch === undefined) return
  const providers = stored.providers.map((entry) => {
    if (entry.id !== target.id) return entry
    // Rebuild the entry without the launch key, so the record (including the
    // previous-pid list) is gone from the file, not just ignored.
    return { id: entry.id, engine: entry.engine, config: entry.config, platform: entry.platform }
  })
  writeStored(stored, { providers })
}

/**
 * handleEngineDeath persists a provider entry's state when its engine process
 * dies outside the plugin's stop path: a crash, a pkill of a plugin-launched
 * child seen through the service's exit watch, or the poll-detected exit of a
 * process adopted after a DSH restart. The entry whose launch record names the
 * dead pid (or the dead engine-and-port, when the report carries no pid match)
 * has its record cleared, so a restart never re-links a dead pid, and the exit
 * line lands in the card's last-run logs beside the engine's own output. An
 * event that matches no entry carrying a record (a stop the route already
 * cleared, an engine the plugin never tracked) is a no-op, which keeps an
 * expected stop quiet.
 */
export function handleEngineDeath(event: EngineDeathEvent): void {
  const stored = readConfig()
  let matched = false
  const providers = stored.providers.map((entry) => {
    const record = entry.launch
    if (record === undefined) return entry
    const byPid = event.pid !== undefined && record.pid === event.pid
    const byEnginePort =
      event.port !== undefined && record.engineId === entry.engine && record.port === event.port
    if (!byPid && !byEnginePort) return entry
    matched = true
    // Rebuild the entry without the launch key, so the record (including the
    // previous-pid list) is gone from the file, not just ignored.
    return { id: entry.id, engine: entry.engine, config: entry.config, platform: entry.platform }
  })
  if (!matched) return
  const signalNote =
    event.signal !== null && event.signal !== undefined
      ? ` on signal ${event.signal}`
      : ` with exit code ${event.code}`
  const note =
    `[local-infer] engine ${event.engineId}` +
    `${event.port !== undefined ? ` (port ${event.port})` : ''}` +
    ` pid ${event.pid ?? 'unknown'} exited${signalNote}` +
    `${event.detail !== undefined ? `: ${event.detail}` : ''}\n`
  writeStored(stored, {
    providers,
    // Keep the last-run tail bounded, the same rule the launch logs cap uses.
    lastLogs: (stored.lastLogs + note).slice(-LOG_TAIL_BYTES),
  })
}

/**
 * persistLaunchLogs stores a launch's captured output as the last run and
 * writes it to the configured log file. The Get-step output the launch ran
 * (the optional getLogs) leads the persisted run, so the Logs section and the
 * log file show the Get steps followed by the launch, not the launch wiping
 * the Get logs. The log file is only written when the run produced output and
 * the log location is set; the last-run logs are always persisted (an empty
 * string clears a stale run) so the card's Logs section shows the previous
 * run after a reload.
 */
export function persistLaunchLogs(
  result: LaunchResult,
  engineId: string,
  config: Config,
  getLogs = '',
): void {
  const stored = readConfig()
  // The "Launching..." separator leads the persisted run, so the Logs
  // section and the log file read the launch as a fresh process section, the
  // same line the card writes when a Launch button is clicked.
  const body = getLogs + (result.logs === undefined ? '' : result.logs)
  const logs = body === '' ? '' : `--- Launching...\n${body}`
  writeStored(stored, { lastLogs: logs })
  if (logs === '') {
    return
  }
  const modelId = typeof config.model === 'string' ? config.model : undefined
  const logPath = resolveLogPath(stored.logPath, engineId, modelId, new Date(), homedir())
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, logs)
  } catch {
    // A log file that cannot be written (a read-only dir, a bad path) must not
    // fail the launch; the in-memory last-run logs still reach the card.
  }
}

/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started. The
 * stop then clears the target entry's launch record (the engine pid and the
 * previous-pid list with it), so a recycled pid cannot re-link an engine the
 * user just stopped. An engine a DSH restart re-adopted carries no tracked
 * child handle in the adapter, so the stop stamps the record's pid on the
 * plan and the adapter signals it through the host; a stop that fails
 * persists a note (the engine, the model, and the host's message) to the
 * stored last-run logs and the log file, so the card's Logs section names the
 * broken step, and re-throws, so the route answers 500 and the card's stop
 * deadline settles the entry to the red Logs state.
 */
export async function stopEngine(
  localInfer: LocalInferService,
  request: LaunchRequest,
): Promise<void> {
  const { stored, engineId, config } = resolveStoredRequest(request)
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  applyComposeArgs(plan, localInfer, engineId)
  // The re-adopted engine's pid: without it the adapter's stop is a no-op for
  // a process it did not spawn, and the engine the user just clicked Stop on
  // keeps running.
  const target = findLaunchTarget(stored, engineId, request.providerId, config)
  if (target?.launch?.pid !== undefined) {
    plan.pid = target.launch.pid
  }
  try {
    await localInfer.stop(plan)
  } catch (error) {
    persistStopFailure(engineId, config, error)
    throw error
  }
  clearLaunchRecord(engineId, config, request.providerId)
}

/**
 * persistStopFailure appends a stop's failure note to the stored last-run logs
 * (the card's Logs section shows it after the summary re-fetch) and writes it
 * to the configured log file, the same per-run file rule the launch step
 * applies. A host that threw without a message reads as "unknown".
 */
function persistStopFailure(engineId: string, config: Config, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  const modelId = typeof config.model === 'string' ? config.model : undefined
  const note =
    `[local-infer] stop failed for ${engineId}` +
    `${modelId !== undefined ? ` (${modelId})` : ''}: ${detail}\n`
  persistProcessLog(note)
}

/**
 * relinkStoredProviders prices every stored provider launch record against the
 * live process table through the service's re-link rule and returns the
 * provider list the card should read: an adopted engine is re-marked plugin-
 * launched and tied to its model by the service, and a liveness watcher starts
 * on its port so a later pkill settles the stored state through the death
 * observer without another summary read; a dead engine's record is cleared on
 * disk here (the previous-pid list with it), so a recycled pid cannot re-link
 * to a config whose engine is down. The route calls it on mount and the
 * summary calls it per read, making re-attach independent of the card opening.
 */
export async function relinkStoredProviders(
  localInfer: LocalInferService,
  stored: StoredConfig,
): Promise<StoredProviderConfig[]> {
  const recorded = stored.providers.filter((provider) => provider.launch !== undefined)
  if (recorded.length === 0) return stored.providers
  const outcomes = await localInfer.reLinkProviders(
    recorded.map((provider) => ({ id: provider.id, record: provider.launch! })),
  )
  if (!recorded.some((provider) => outcomes[provider.id] === 'dead')) {
    return stored.providers
  }
  const providers = stored.providers.map((provider) => {
    if (provider.launch === undefined || outcomes[provider.id] !== 'dead') {
      return provider
    }
    // Rebuild the dead entry without the launch key, so the record (including
    // the previous-pid list) is gone from the file, not just ignored.
    return {
      id: provider.id,
      engine: provider.engine,
      config: provider.config,
      platform: provider.platform,
    }
  })
  writeStored(stored, { providers })
  return providers
}

/**
 * GetOutcome is the answer the Get step reports: ok with no detail, or a
 * failure naming the broken step. The object literal union keeps the
 * invariant the card reads: a detail only exists on a failure.
 */
export type GetOutcome = { ok: true } | { ok: false; detail?: string }

/**
 * getEngine is the Get step: a thin wrapper over the shared Get-steps routine
 * (the system dependencies, the git sync, the build, the model download, and
 * the chat-template download), streaming every step through log as it lands,
 * so the card appends it to the Logs section live. The dependency install
 * only runs while the Play/Run trust gate is on; with the gate off the deps
 * are re-checked and a missing one aborts the step with the copy/paste note.
 * The optional signal is the card's cancel: an abort interrupts the in-flight
 * hf download child (SIGINT, then SIGTERM). Resume is within-invocation only:
 * the hf CLI (huggingface_hub 2.x) resumes a network blip via HTTP Range inside
 * one `hf download` run, but a killed run re-downloads from zero on the re-run
 * (each run writes a process-unique `.incomplete` temp blob and unlinks it on
 * failure), so an orphaned partial blob lingers until `hf cache prune`. The
 * optional onChunk is the hf download's raw stderr progress sink: the
 * download runner hands each streamed chunk to it as it lands, separate from
 * the log sink, so the route parses the tqdm lines into progress events.
 */
export async function getEngine(
  localInfer: LocalInferService,
  request: GetRequest,
  log: (chunk: string) => void,
  host: LifecycleHost = nodeLifecycleHost,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<GetOutcome> {
  const { stored, engineId, config } = resolveStoredRequest(request)
  // Register the request's platform override the same way launchEngine does,
  // so the next launch reads the Engine Directory / Engine Fork the Get used.
  const platform = registerLaunchPlatform(localInfer, request, stored, engineId, config)
  const result = await runGetSteps(
    localInfer,
    {
      engineId,
      config,
      ...(platform !== undefined ? { platform } : {}),
      allowRunDeps: stored.allowRunDeps,
      host,
      ...(signal !== undefined ? { signal } : {}),
      ...(onChunk !== undefined ? { onChunk } : {}),
    },
    log,
  )
  return { ok: result.ok, ...(result.detail !== undefined ? { detail: result.detail } : {}) }
}

/**
 * The route's view of which engine platform configs are registered with the
 * service, keyed by engine id. The service registry is the single source the
 * launch step reads, so the route keeps it in sync with the stored config:
 * on route registration, after every save, and when a launch request carries
 * a platform override. A disposer is tracked per engine, so an engine whose
 * stored config is cleared is unregistered rather than left stale.
 */
const platformDisposers = new Map<string, () => void>()

/**
 * setPlatformConfig registers one engine's platform config with the service,
 * replacing any stored entry. A config with no fields is read as "no platform
 * config", which unregisters the engine so the deploy step falls back to the
 * adapter's default source and cache directory.
 */
function setPlatformConfig(
  localInfer: LocalInferService,
  engineId: string,
  config: StoredPlatformConfig | undefined,
): void {
  platformDisposers.get(engineId)?.()
  platformDisposers.delete(engineId)
  if (config === undefined) {
    return
  }
  if (
    config.engineDirectory === undefined &&
    config.engineFork === undefined &&
    config.buildCommands === undefined &&
    config.dockerTag === undefined
  ) {
    return
  }
  const platform: EnginePlatformConfig = { engineId, ...config }
  platformDisposers.set(engineId, localInfer.registerEnginePlatformConfig(platform))
}

/**
 * syncPlatformConfigs re-syncs the service registry with the stored platform
 * map: it registers (or re-registers) every engine that carries a config, and
 * unregisters every engine that no longer does, so a launch always reads the
 * platform config the user last saved.
 */
export function syncPlatformConfigs(
  localInfer: LocalInferService,
  stored: StoredConfig,
): void {
  const wanted = stored.platform
  for (const engineId of [...platformDisposers.keys()]) {
    if (wanted[engineId] === undefined) {
      setPlatformConfig(localInfer, engineId, undefined)
    }
  }
  for (const [engineId, config] of Object.entries(wanted)) {
    setPlatformConfig(localInfer, engineId, config)
  }
}
