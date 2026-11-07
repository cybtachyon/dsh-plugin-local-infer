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

import type {
  Config,
  EnginePlatformConfig,
  LaunchPlan,
  LaunchStep,
  LifecycleHost,
} from 'dsh-plugin-local-infer/core'
import {
  SUDO_CLI_NOTE,
  formatLaunchCommand,
  launchRecordFromPlan,
} from '../../../core/lib/index.js'
import type {
  EngineDeathEvent,
  LaunchResult,
  LocalInferService,
} from 'dsh-plugin-local-infer/service'
import { findLaunchTarget, runLogKey } from '../../../service/lib/index.js'
import { nodeLifecycleHost } from '../../../providers/lib/index.js'
import type {
  StoredConfig,
  StoredPlatformConfig,
  StoredProviderConfig,
} from '../config.ts'
import { readConfig, writeStored } from '../config.ts'
import {
  CANCELED_LINE,
  LAUNCH_RUN_SEED,
  STOP_RUN_SEED,
  capRunLogs,
  persistProcessLog,
  writeRunFile,
} from './logs.ts'
import { resolveEngineDirectory, runGetSteps } from './get-steps.ts'
import type { GetStepsRequest, GetStepsResult } from './get-steps.ts'
import { RouteError } from '../route.ts'
import type { GetRequest, LaunchRequest } from '../request.ts'

/**
 * CANCELED_LINE names the shared "Canceled" run line; it lives with the other
 * run-line constants in ops/logs.ts and is re-exported here for the launch
 * persisters' import surface.
 */
export { CANCELED_LINE } from './logs.ts'

/**
 * GET_EVENT_PREFIX leads a Get run's event lines in the streamed and
 * persisted run (the route's `get failed` line and getEngine's sudo CLI
 * note), so both read alike and the `!!` marker has one home (routes/get.ts
 * and getEngine both build it from here).
 */
export const GET_EVENT_PREFIX = '!! '

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
  writeStored(stored, { lastLogs: capRunLogs(logs) })
}

/**
 * resolveStoredRequest resolves a route request's engine and config against
 * the stored config: the request's fields win, and an absent field falls back
 * to the stored value, the same rule every route applies. The Get route
 * reads it for its run-log key before delegating to getEngine.
 */
export function resolveStoredRequest(
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
 * to the engine's default checkout home (`~/.cache/dsh/infer/{engineId}`),
 * so the deploy step resolves a relative launch path (the NInfer Windows
 * build tree) against a real checkout; the fallback is registered in the
 * service registry only (memory, never the stored platform map), and a
 * stored entry that already names a directory is left as-is. An absent
 * request platform keeps the stored entry, which the save route and route
 * registration already synced.
 */
function registerLaunchPlatform(
  localInfer: LocalInferService,
  request: { platform?: StoredPlatformConfig },
  stored: StoredConfig,
  engineId: string,
): StoredPlatformConfig | undefined {
  if (request.platform !== undefined) {
    setPlatformConfig(localInfer, engineId, request.platform)
  }
  const platform = request.platform ?? stored.platform[engineId]
  // resolveEngineDirectory is the one home of the override-or-default rule,
  // so the registration decision compares against its answer instead of
  // restating the blank check: a platform that already names the effective
  // directory needs no registration.
  const engineDirectory = resolveEngineDirectory(engineId, platform)
  if (platform?.engineDirectory !== engineDirectory) {
    setPlatformConfig(localInfer, engineId, { ...platform, engineDirectory })
  }
  return platform
}

/**
 * getStepsRequest builds the shared Get-steps request both getEngine and
 * launchEngine run: the engine and config, the platform entry the checkout
 * resolves against, the Play/Run trust gate, and the lifecycle host plus the
 * optional cancel signal and download-progress sink. The exactOptionalProperty-
 * types-safe spreads keep an absent field from writing `undefined`, so the
 * host, signal, and sink travel as one group built in one place. Each caller
 * layers its own extras on the result: the launch adds autoRebuild and the
 * sync override, a standalone Get adds none.
 */
function getStepsRequest(
  engineId: string,
  config: Config,
  stored: StoredConfig,
  platform: StoredPlatformConfig | undefined,
  host: LifecycleHost,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): GetStepsRequest {
  return {
    engineId,
    config,
    ...(platform !== undefined ? { platform } : {}),
    allowRunDeps: stored.allowRunDeps,
    host,
    ...(signal !== undefined ? { signal } : {}),
    ...(onChunk !== undefined ? { onChunk } : {}),
  }
}

/**
 * registerSudoObserver registers the run's sudo hook on the service under
 * the run's key (the hub's own keying) and returns the disposer that removes
 * only this hook: concurrent runs each keep their own slot, a re-launch
 * under the same key takes the slot from the older run, and the first settle
 * never clears another run's note routing. The service hands every guarded
 * announcement to every registered hook (the shared CLI password wait can
 * block any run, and the announce seam does not name the triggering run), so
 * one wait notes every run in flight. launchEngine and getEngine share the
 * helper so the sudo-note rule has one home: the hook appends noteLine to
 * the run's own sink (the note rides the streamed run and the run text
 * persisted when the step settles) and through persistProcessLog (so a run
 * still hung on the prompt reads the note in the Logs section and the log
 * file before it settles), then calls onSudo, the route's stream event; a
 * Get passes none because its control keeps its throbber. The caller invokes
 * the disposer in a finally so a failed run leaves no hook behind.
 */
function registerSudoObserver(
  localInfer: LocalInferService,
  runKey: string,
  noteLine: string,
  noteTo: (text: string) => void,
  onSudo?: () => void,
): () => void {
  return localInfer.registerSudoObserver(runKey, () => {
    noteTo(noteLine)
    persistProcessLog(noteLine.replace(/\n$/, ''))
    onSudo?.()
  })
}

/**
 * launchEngine runs the shared Get-steps routine (idempotent: deps, git sync,
 * build, model download, chat-template download, each skipped when already
 * satisfied) and then renders the plan the registered adapter produces for
 * the config and the detected hardware, and runs the service's launch entry
 * point (deploy, then the health poll). A git sync of an existing checkout
 * that fails under the continueOnSyncFailure override (always on for a
 * launch) keeps the Get run going with the checkout's current version and
 * reports syncFailed on the result; the launch then threads autoRebuild:
 * false into the deploy step, which skips its own git sync (it would hit the
 * same rebase conflict) and launches the current version, while the Get
 * error line persists in the last-run logs and the log file. The detail the
 * launch returns names the broken step when the engine does not come up.
 * The launch line (the
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
 * steps streams the download progress the same way a Get does. The optional
 * onSudo is the route's sudo-event writer: while the run is in flight, the
 * service's sudo observer answers a guarded command waiting for a password on
 * the launching CLI by landing the core CLI note in the run logs and the log
 * file and calling onSudo; the observer is unregistered when the run settles,
 * failed or not, so a failing run leaves none behind. The whole run brackets
 * one live hub run under the runLogKey rule (the "--- Launching..." seed,
 * the Get-steps sink, the command note, the deploy and engine output at
 * settle, end in a finally), so the streaming logs route reads the launch.
 */
export async function launchEngine(
  localInfer: LocalInferService,
  request: LaunchRequest,
  onProgress?: (step: LaunchStep) => void,
  host: LifecycleHost = nodeLifecycleHost,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
  onSudo?: () => void,
): Promise<LaunchResult> {
  const { stored, engineId, config } = resolveStoredRequest(request)
  const adapter = resolveAdapter(localInfer, engineId)
  // The run key this launch's live buffer rides, the shared runLogKey rule
  // the streaming logs route resolves the same way. The seed resets the
  // key's buffer, so a mid-run re-launch replaces the previous run's text.
  const runKey = runLogKey(stored.providers, engineId, request.providerId, config)
  let runText = ''
  const appendRunText = (chunk: string): void => {
    runText += chunk
    // One chunk, two readers: the persisted run and the live hub, no third
    // copy of the text.
    localInfer.appendRunLog(runKey, chunk)
  }
  // The run owns the sudo observer, not the route, so the note lands in the
  // persisted run and in the stream from one place (see
  // registerSudoObserver): the CLI note appends to the Get-step log sink
  // (composeLaunchLogs and persistLaunchOutcome carry it into the last-run
  // logs and the log file), persists to disk while the run is still hung
  // waiting on the prompt, and tells the route's stream writer.
  const clearSudoObserver = registerSudoObserver(
    localInfer,
    runKey,
    `${SUDO_CLI_NOTE}\n`,
    appendRunText,
    onSudo,
  )
  localInfer.beginRun(runKey, LAUNCH_RUN_SEED)
  try {
    const hardware = await localInfer.detectHardware()
    const platform = registerLaunchPlatform(localInfer, request, stored, engineId)
    // The prereqs phase: the system-dependency install the Get-steps routine
    // runs. It runs only while the Play/Run trust gate is on, the same rule
    // the Get step applies. The card's button reads "Prereqs..." for this
    // phase, so the phase is reported only while an install actually runs
    // (the gate on), not when the deps are already satisfied and the phase
    // is skipped.
    if (stored.allowRunDeps === true) {
      onProgress?.('prereqs')
    }
    // The Get steps (deps, git sync, build, model download, chat-template
    // download) run idempotently before the launch plan renders, so a launch
    // never reads a missing checkout, binary, model, or template. The Auto
    // Rebuild checkbox off skips the sync and build steps, the same rule the
    // adapter's deploy step applies. The launch always sets
    // continueOnSyncFailure: a failed git sync of an existing checkout
    // reports syncFailed on the result (the run keeps going with the
    // checkout's current version) instead of halting the launch.
    const get = await runGetSteps(
      localInfer,
      {
        ...getStepsRequest(engineId, config, stored, platform, host, signal, onChunk),
        ...(request.autoRebuild !== undefined ? { autoRebuild: request.autoRebuild } : {}),
        continueOnSyncFailure: true,
      },
      appendRunText,
    )
    const plan = adapter.renderLaunch(config, hardware)
    if (!get.ok) {
      if (signal?.aborted === true) {
        localInfer.appendRunLog(runKey, CANCELED_LINE)
      }
      return settleGetFailure(
        plan,
        get,
        engineId,
        config,
        request.providerId,
        runText,
        signal?.aborted === true,
      )
    }
    applyComposeArgs(plan, localInfer, engineId)
    const commandNote = launchCommandNote(plan)
    if (commandNote !== undefined) {
      // Persist before the deploy starts: a slow or hung launch keeps the Get
      // steps and the command readable in the Logs section across a card
      // reload, where the engine output has not landed yet.
      persistStoredLogs(runText + commandNote)
      localInfer.appendRunLog(runKey, commandNote)
    }
    // The trust gate and the auto-rebuild flag ride into the deploy step,
    // which reads them to decide whether a rebuild's missing-binary symlink
    // into /usr/local/bin runs (on) or is written to the card's Logs section
    // (off), and whether the deploy's own git sync (fetch, rebase, rebuild)
    // runs at all. A Get sync that failed under the override threads
    // autoRebuild: false into the deploy, which skips its own git sync (it
    // would hit the same rebase conflict) and launches the checkout's
    // current version; a Get run whose sync passed keeps the request's
    // autoRebuild.
    const launchAutoRebuild = get.syncFailed === true ? false : request.autoRebuild
    const result = await localInfer.launch(
      plan,
      {
        ...(onProgress !== undefined ? { onProgress } : {}),
        allowRunDeps: stored.allowRunDeps,
        ...(launchAutoRebuild !== undefined ? { autoRebuild: launchAutoRebuild } : {}),
      },
    )
    // The deploy step's build output and the engine's runtime output reach
    // the live buffer at settle (they only exist once the launch returns;
    // the Get-step sink and the command note already streamed through
    // appendRunLog). composeLaunchLogs then folds every part into the
    // persisted order (Get steps, build, command, engine), where the hub
    // carries them in arrival order (Get steps, command, build, engine).
    const deployLogs = result.buildLogs ?? ''
    const engineLogs = result.logs ?? ''
    if (deployLogs + engineLogs !== '') {
      localInfer.appendRunLog(runKey, deployLogs + engineLogs)
    }
    // A cancel that landed after the Get steps (the card's provider-form Cancel
    // closed the stream during the deploy or health poll) adds the "Canceled"
    // line, so the persisted run reads as canceled.
    const canceled = signal?.aborted === true
    composeLaunchLogs(result, runText, commandNote, canceled)
    if (canceled) {
      localInfer.appendRunLog(runKey, CANCELED_LINE)
    }
    // The result's logs field already carries the Get-step output via
    // composeLaunchLogs, so the persisted run leads with no runText. Passing
    // runText again would include the Get steps twice in the persisted run.
    persistLaunchOutcome(result, engineId, config, request.providerId, '')
    return result
  } finally {
    clearSudoObserver()
    // The bracket closes on every settle path: healthy, failed, and canceled
    // all clear the key's running flag.
    localInfer.endRun(runKey)
  }
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
  runText: string,
  commandNote: string | undefined,
  canceled: boolean,
): void {
  const buildLogs = result.buildLogs ?? ''
  const engineLogs = result.logs ?? ''
  result.logs = runText + buildLogs + (commandNote ?? '') + engineLogs
  if (result.buildLogs !== undefined) {
    delete result.buildLogs
  }
  if (canceled) {
    result.logs += CANCELED_LINE
  }
}

/**
 * persistLaunchOutcome persists a settled launch: the run logs to the stored
 * last-run logs and the log file, and the launch record on the target
 * provider entry, so a DSH restart can re-link a surviving engine to its
 * config. The runText argument leads the persisted run only when the result
 * carries no logs of its own (the get-failed path, where the deploy never
 * ran). The success path passes an empty string, because composeLaunchLogs
 * already folded the Get-step output into the result's logs, and leading it
 * again would include the Get steps twice.
 */
function persistLaunchOutcome(
  result: LaunchResult,
  engineId: string,
  config: Config,
  providerId: string | undefined,
  runText: string,
): void {
  persistLaunchLogs(result, engineId, config, runText)
  persistLaunchRecord(result, engineId, config, providerId)
}

/**
 * settleGetFailure settles a launch whose Get steps failed before the deploy
 * starts: it builds the unhealthy result (naming the broken step), persists
 * the run (the Get-step output leads, and a cancel that landed adds the
 * "Canceled" line, so the run reads as canceled), and returns the result so
 * the route answers with it.
 */
function settleGetFailure(
  plan: LaunchPlan,
  get: GetStepsResult,
  engineId: string,
  config: Config,
  providerId: string | undefined,
  runText: string,
  canceled: boolean,
): LaunchResult {
  const result: LaunchResult = {
    plan,
    healthy: false,
    detail: get.detail ?? 'a Get step failed',
  }
  persistLaunchOutcome(
    result,
    engineId,
    config,
    providerId,
    canceled ? runText + CANCELED_LINE : runText,
  )
  return result
}

/**
 * withoutLaunchRecord returns a provider entry with its launch record (the
 * engine pid and the previous-pid list) removed, so the record is gone from
 * the file, not just ignored, and a recycled pid cannot re-link to a config
 * whose engine is stopped or dead. The stop, death, and re-link paths share
 * it, so the rebuilt entry shape lives in one place.
 */
function withoutLaunchRecord(entry: StoredProviderConfig): StoredProviderConfig {
  return { id: entry.id, engine: entry.engine, config: entry.config, platform: entry.platform }
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
  const target = findLaunchTarget(stored.providers, engineId, providerId, config)
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
  const target = findLaunchTarget(stored.providers, engineId, providerId, config)
  if (target === undefined || target.launch === undefined) return
  const providers = stored.providers.map((entry) =>
    entry.id === target.id ? withoutLaunchRecord(entry) : entry,
  )
  writeStored(stored, { providers })
}

/**
 * RunLogWriter is the hub slice handleEngineDeath needs: the catch-up read,
 * the append, and the settle. The LocalInfer service satisfies it, so the
 * route's observer closure can hand the service itself to the note path.
 */
export type RunLogWriter = Pick<
  LocalInferService,
  'readRunLog' | 'appendRunLog' | 'endRun'
>

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
 * expected stop quiet. With a run-log hub (the route's observer closure
 * captures the service), the same note line also lands in the dead entry's
 * live buffer: the snapshot is read first, and if the run was NOT already
 * running, the append's lazy reopen is settled with endRun right after, so a
 * late note streams without stranding the key as running.
 */
export function handleEngineDeath(event: EngineDeathEvent, runLogs?: RunLogWriter): void {
  const stored = readConfig()
  let matched: StoredProviderConfig | undefined
  const providers = stored.providers.map((entry) => {
    const record = entry.launch
    if (record === undefined) return entry
    const byPid = event.pid !== undefined && record.pid === event.pid
    const byEnginePort =
      event.port !== undefined && record.engineId === entry.engine && record.port === event.port
    if (!byPid && !byEnginePort) return entry
    matched = matched ?? entry
    return withoutLaunchRecord(entry)
  })
  if (matched === undefined) return
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
    lastLogs: capRunLogs(stored.lastLogs + note),
  })
  if (runLogs === undefined) return
  // The death's run key follows the runLogKey rule over the matched entry
  // (the same resolution the launch wrote the buffer under: the entry id
  // when its config names the model, else the engine id).
  const runKey = runLogKey(stored.providers, event.engineId, undefined, matched.config)
  const wasRunning = runLogs.readRunLog(runKey).running
  runLogs.appendRunLog(runKey, note)
  if (!wasRunning) {
    runLogs.endRun(runKey)
  }
}

/**
 * persistLaunchLogs stores a launch's captured output as the last run and
 * writes it to the configured log file. The Get-step output the launch ran
 * (the optional runText) leads the persisted run, so the Logs section and the
 * log file show the Get steps followed by the launch, not the launch wiping
 * the Get logs. The stored last-run logs ride the shared capRunLogs tail rule
 * (ops/logs.ts), the same cap the append paths and the live hub apply. The
 * log file is only written when the run produced output and the log location
 * is set; the last-run logs are always persisted (an empty string clears a
 * stale run) so the card's Logs section shows the previous run after a
 * reload.
 */
export function persistLaunchLogs(
  result: LaunchResult,
  engineId: string,
  config: Config,
  runText = '',
): void {
  const stored = readConfig()
  // The "Launching..." separator leads the persisted run, so the Logs
  // section and the log file read the launch as a fresh process section, the
  // same line the launch's live hub run seeds with (LAUNCH_RUN_SEED).
  const body = runText + (result.logs === undefined ? '' : result.logs)
  const logs = body === '' ? '' : `${LAUNCH_RUN_SEED}${body}`
  writeStored(stored, { lastLogs: capRunLogs(logs) })
  if (logs === '') {
    return
  }
  const modelId = typeof config.model === 'string' ? config.model : undefined
  writeRunFile(stored, logs, engineId, modelId)
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
  const target = findLaunchTarget(stored.providers, engineId, request.providerId, config)
  if (target?.launch?.pid !== undefined) {
    plan.pid = target.launch.pid
  }
  const runKey = runLogKey(stored.providers, engineId, request.providerId, config)
  localInfer.beginRun(runKey, STOP_RUN_SEED)
  try {
    await localInfer.stop(plan)
    clearLaunchRecord(engineId, config, request.providerId)
  } catch (error) {
    persistStopFailure(engineId, config, error, localInfer, runKey)
    throw error
  } finally {
    localInfer.endRun(runKey)
  }
}

/**
 * persistStopFailure appends a stop's failure note to the stored last-run logs
 * (the card's Logs section shows it after the summary re-fetch) and writes it
 * to the configured log file, the same per-run file rule the launch step
 * applies, and to the stop's live run-log buffer under runKey (one note text,
 * no third copy). A host that threw without a message reads as "unknown".
 */
function persistStopFailure(
  engineId: string,
  config: Config,
  error: unknown,
  localInfer: LocalInferService,
  runKey: string,
): void {
  const detail = error instanceof Error ? error.message : String(error)
  const modelId = typeof config.model === 'string' ? config.model : undefined
  const note =
    `[local-infer] stop failed for ${engineId}` +
    `${modelId !== undefined ? ` (${modelId})` : ''}: ${detail}\n`
  persistProcessLog(note)
  localInfer.appendRunLog(runKey, note)
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
  const providers = stored.providers.map((provider) =>
    provider.launch !== undefined && outcomes[provider.id] === 'dead'
      ? withoutLaunchRecord(provider)
      : provider,
  )
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
 * the log sink, so the route parses the tqdm lines into progress events. The
 * run registers the same sudo observer a launch does: a guarded command
 * waiting for the user's password on the launching CLI writes the core CLI
 * note through log as a GET_EVENT_PREFIX line, the same marker the route's
 * own failure line uses, so the note rides the streamed run and the run text
 * the route persists, and through persistProcessLog so a run still hung on
 * the prompt reads it before it settles. The Get control keeps its throbber,
 * so the observer announces nothing beyond the note line.
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
  const platform = registerLaunchPlatform(localInfer, request, stored, engineId)
  // The Get run owns the sudo hook for the run's duration, registered under
  // the same runLogKey rule the route brackets the live hub run with (see
  // registerSudoObserver); the finally leaves only this run's slot cleared.
  const clearSudoObserver = registerSudoObserver(
    localInfer,
    runLogKey(stored.providers, engineId, undefined, config),
    `${GET_EVENT_PREFIX}${SUDO_CLI_NOTE}\n`,
    log,
  )
  try {
    const result = await runGetSteps(
      localInfer,
      getStepsRequest(engineId, config, stored, platform, host, signal, onChunk),
      log,
    )
    return { ok: result.ok, ...(result.detail !== undefined ? { detail: result.detail } : {}) }
  } finally {
    clearSudoObserver()
  }
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
