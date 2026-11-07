/**
 * The Play/Run helper for the deps panel: runInstallFor refuses with a 409
 * while the trust gate is off (the copy/paste path is always the fallback),
 * runs the install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 * @module dsh-plugin-local-infer/ui/viewmodels/depsHelpers
 */

import type { InstallResult } from 'dsh-plugin-local-infer/core'
import { SUDO_CLI_NOTE } from '../../../core/lib/index.js'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { runLogKey } from '../../../service/lib/index.js'
import { readConfig } from '../config.ts'
import type { DepsModel } from '../deps.ts'
import { captureRunBaseline, finishRunSection, INSTALL_RUN_SEED } from '../ops/logs.ts'
import { registerSudoObserver } from '../ops/engine.ts'
import { RouteError } from '../route.ts'
import type { DepsRequest } from '../request.ts'
import { buildDeps } from './deps.ts'

/**
 * InstallResponse is the answer to a Play/Run: the install result and the
 * refreshed deps model, so the card re-renders the gate from the same
 * re-check the install ran.
 */
export interface InstallResponse {
  result: InstallResult
  deps: DepsModel
}

/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes. A run that
 * actually starts brackets one live hub run under the runLogKey rule (the
 * stored entry matching the engine and model, else the engine id): the seed
 * is the "Installing deps..." separator, the service writes each install
 * command's `$ <command>` line into the run (through onLog) before its child
 * spawns, each per-dep install result appends in the Get step's
 * `  <id>: <status>` shape, and the run ends at settle, a throwing install
 * included. The settle text also folds through the shared run-section persister
 * (finishRunSection over the pre-run baseline), so the last install run
 * survives a card reload in the stored last-run logs and the log file, like
 * the other provider processes; the baseline close keeps the sudo note the
 * observer persists mid-run from landing twice. The run registers the sudo
 * hook the launch and Get paths register, so a guarded dependency install
 * waiting for a password on the CLI lands the shared SUDO_CLI_NOTE line in
 * the live run and the persisted run. A 409 refusal starts no run.
 */
export async function runInstallFor(
  localInfer: LocalInferService,
  request: DepsRequest,
): Promise<InstallResponse> {
  const stored = readConfig()
  if (stored.allowRunDeps !== true) {
    throw new RouteError(409, 'one-click install is not allowed; copy the install string instead')
  }
  const model = await buildDeps(localInfer, request)
  const hardware = await localInfer.detectHardware()
  const runKey = runLogKey(
    stored.providers,
    model.engineId,
    undefined,
    request.config ?? stored.config,
  )
  // The install run owns a sudo hook under its run key (the shared
  // registerSudoObserver wiring): a guarded install waiting on the CLI writes
  // the core CLI note into the live hub and, through persistProcessLog inside
  // the helper, into the persisted run and log file, so a hung install reads
  // where the prompt landed. The disposer clears only this run's slot.
  // One append feeds both readers: the live hub run and the run's collected
  // settle text (persisted at the finally), no second copy of the text.
  let collected = ''
  const append = (line: string): void => {
    collected += line
    localInfer.appendRunLog(runKey, line)
  }
  const clearSudoObserver = registerSudoObserver(
    localInfer,
    runKey,
    `${SUDO_CLI_NOTE}\n`,
    append,
  )
  // The stored last-run logs as they stand before the run persists anything:
  // the sudo observer persists its note while the run hangs on the prompt,
  // and finishRunSection closes the run over the baseline so that provisional
  // line and the collected run text persist once (the Get route's pattern).
  const baseline = captureRunBaseline()
  localInfer.beginRun(runKey, INSTALL_RUN_SEED)
  try {
    const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware, {
      // Each install command's `$ <command>` line reaches the live hub and the
      // collected run before the guarded runner spawns the child, so the run
      // reads the command ahead of the per-dep results below.
      onLog: append,
    })
    // The per-dep results stream as the re-check reported them, in the same
    // indented shape the Get step's dep block logs, so both readers (the
    // live buffer and, later, a re-rendered Logs pane) say the same thing.
    for (const entry of result.results) {
      append(`  ${entry.id}: ${entry.status}${entry.detail !== undefined ? ` (${entry.detail})` : ''}\n`)
    }
    const deps = model.deps.map((dep) => {
      const entry = result.results.find((entry) => entry.id === dep.id)
      return entry === undefined ? dep : { ...dep, status: entry.status }
    })
    return {
      result,
      deps: { ...model, deps, allSatisfied: result.ok },
    }
  } finally {
    clearSudoObserver()
    // The settle fold: the run's text (seed, command lines, per-dep results,
    // any sudo note) persists as one section so a card reload still shows the
    // last install run. A throwing install persists the partial section (the
    // commands that ran) before the error reaches the route.
    finishRunSection(baseline, `${INSTALL_RUN_SEED}${collected}`)
    localInfer.endRun(runKey)
  }
}
