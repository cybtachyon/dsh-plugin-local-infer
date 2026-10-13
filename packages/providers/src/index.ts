/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, strata), the NInfer VramModel, the
 * built-in presets, the built-in guidelines, and the per-OS SystemDep install
 * command data. Each registers itself with `ctx.localInfer`.
 *
 * In the scaffold this plugin is a no-op placeholder that injects the seam so
 * the bundle loads with zero providers. Phase 5 fills in the adapter
 * registrations and Phase 7 the preset and guideline data.
 * @module @dsh/dsh-plugin-local-infer/providers
 */

import type { Context } from '@deepseek-ai/cordis'
// The service's `declare module` adds `localInfer` to the cordis Context; the
// type import loads that augmentation without a runtime edge.
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
import { NINFER_VRAM_MODELS } from './vram.ts'

export const name = 'local-infer-providers'
export const inject = ['localInfer']

/**
 * The engine parameter surfaces, re-exported for the UI form renderer and the
 * Phase 5 adapters. NInfer's surface is CLI flags (`toArgv`); Hyper-Qwen's is
 * `.env` keys (`toEnv`).
 */
export {
  CTX_OPTIONS,
  HYPERQWEN_PARAMETERS,
  KV_OPTIONS,
  SPEC_OPTIONS as HYPERQWEN_SPEC_OPTIONS,
} from './hyperqwen.ts'
export {
  DEVICE_PROFILE_OPTIONS,
  KV_DTYPE_OPTIONS,
  NINFER_PARAMETERS,
  SPEC_OPTIONS as NINFER_SPEC_OPTIONS,
} from './ninfer.ts'
export { NINFER_VRAM_MODELS, ninferVramModel } from './vram.ts'
export { ENGINES } from './engines.ts'
export type { EngineInfo } from './engines.ts'

/**
 * Mount the providers. The NInfer measured VramModels register here so the
 * service's estimate prices a named model; the engine adapters, presets, and
 * guidelines land in later phases.
 */
export function apply(ctx: Context): void {
  const localInfer: LocalInferService = ctx.localInfer
  for (const model of NINFER_VRAM_MODELS) {
    localInfer.registerVramModel(model)
  }
}

const plugin = { name, inject, apply }
export default plugin
