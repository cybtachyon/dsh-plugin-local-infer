/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, strata), the NInfer VramModel, the
 * built-in presets, the built-in guidelines, and the per-OS SystemDep install
 * command data. Each registers itself with `ctx.localInfer`.
 *
 * Phase 3 registers the NInfer measured VramModels and the built-in hardware
 * guidelines. The engine adapters land in Phase 5 and the preset data in
 * Phase 7.
 * @module @dsh/dsh-plugin-local-infer/providers
 */

import type { Context } from '@deepseek-ai/cordis'
// The service's `declare module` adds `localInfer` to the cordis Context; the
// type import loads that augmentation without a runtime edge.
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
import { BUILTIN_GUIDELINES } from './guidelines.ts'
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
export { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from './guidelines.ts'
export { ENGINES } from './engines.ts'
export type { EngineInfo } from './engines.ts'

/**
 * Mount the providers. The NInfer measured VramModels register here so the
 * service's estimate prices a named model; the built-in hardware guidelines
 * register so the guideline engine warns on docker, host RAM, and WSL2
 * before the engine boots. The engine adapters and presets land in later
 * phases.
 */
export function apply(ctx: Context): void {
  const localInfer: LocalInferService = ctx.localInfer
  for (const model of NINFER_VRAM_MODELS) {
    localInfer.registerVramModel(model)
  }
  for (const guideline of BUILTIN_GUIDELINES) {
    localInfer.registerGuideline(guideline)
  }
}

const plugin = { name, inject, apply }
export default plugin
