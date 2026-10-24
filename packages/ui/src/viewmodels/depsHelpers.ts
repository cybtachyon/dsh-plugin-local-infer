/**
 * The Play/Run helper for the deps panel: runInstallFor refuses with a 409
 * while the trust gate is off (the copy/paste path is always the fallback),
 * runs the install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 * @module dsh-plugin-local-infer/ui/viewmodels/depsHelpers
 */

import type { InstallResult } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { readConfig } from '../config.ts'
import type { DepsModel } from '../deps.ts'
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
 * re-check, so the "Get" gate opens only after a re-check passes.
 */
export async function runInstallFor(
  localInfer: LocalInferService,
  request: DepsRequest,
): Promise<InstallResponse> {
  if (readConfig().allowRunDeps !== true) {
    throw new RouteError(409, 'one-click install is not allowed; copy the install string instead')
  }
  const model = await buildDeps(localInfer, request)
  const hardware = await localInfer.detectHardware()
  const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware)
  const deps = model.deps.map((dep) => {
    const entry = result.results.find((entry) => entry.id === dep.id)
    return entry === undefined ? dep : { ...dep, status: entry.status }
  })
  return {
    result,
    deps: { ...model, deps, allSatisfied: result.ok },
  }
}
