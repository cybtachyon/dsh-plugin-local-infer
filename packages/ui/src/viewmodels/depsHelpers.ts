/**
 * The Play/Run helper for the deps panel: runInstallFor refuses with a 409
 * while the trust gate is off (the copy/paste path is always the fallback),
 * runs the install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 * @module dsh-plugin-local-infer/ui/viewmodels/depsHelpers
 */

import type { InstallResult } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { runLogKey } from '../../../service/lib/index.js'
import { readConfig } from '../config.ts'
import type { DepsModel } from '../deps.ts'
import { INSTALL_RUN_SEED } from '../ops/logs.ts'
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
 * is the "Installing deps..." separator, each per-dep install result appends
 * in the Get step's `  <id>: <status>` shape, and the run ends at settle,
 * a throwing install included. A 409 refusal starts no run.
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
  localInfer.beginRun(runKey, INSTALL_RUN_SEED)
  try {
    const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware)
    // The per-dep results stream as the re-check reported them, in the same
    // indented shape the Get step's dep block logs, so both readers (the
    // live buffer and, later, a re-rendered Logs pane) say the same thing.
    for (const entry of result.results) {
      localInfer.appendRunLog(
        runKey,
        `  ${entry.id}: ${entry.status}${entry.detail !== undefined ? ` (${entry.detail})` : ''}\n`,
      )
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
    localInfer.endRun(runKey)
  }
}
