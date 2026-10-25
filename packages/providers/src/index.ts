/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, infernix, strata), the NInfer
 * VramModel, the built-in presets, the built-in guidelines, and the per-OS
 * SystemDep install command data. Each registers itself with `ctx.localInfer`.
 *
 * Phase 3 registers the NInfer measured VramModels and the built-in hardware
 * guidelines. The engine adapters land in Phase 5. Phase 7 registers the
 * built-in preset data (the NInfer measured and Hyper-Qwen profile presets)
 * that the defaults resolver resolves against.
 * @module dsh-plugin-local-infer/providers
 */

import type { Context } from '@deepseek-ai/cordis'
// The service's `declare module` adds `localInfer` to the cordis Context; the
// type import loads that augmentation without a runtime edge.
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { createNodeLifecycleHost } from './adapters.ts'
import { HyperQwenAdapter } from './engines/hyperqwenAdapter.ts'
import { InfernixAdapter } from './engines/infernixAdapter.ts'
import { LlamaCppAdapter } from './engines/llamacppAdapter.ts'
import { NInferAdapter } from './engines/ninferAdapter.ts'
import { StrataAdapter } from './engines/strataAdapter.ts'
import { createDshDebugLogger } from './debug.ts'
import { ENGINE_DEP_PLANS } from './deps.ts'
import { BUILTIN_GUIDELINES } from './guidelines.ts'
import { BUILTIN_PRESETS } from './presets.ts'
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
} from './engines/hyperqwen.ts'
export {
  CHAT_TEMPLATE_OPTIONS,
  DEVICE_PROFILE_OPTIONS,
  KV_DTYPE_OPTIONS,
  NINFER_PARAMETERS,
  SPEC_OPTIONS as NINFER_SPEC_OPTIONS,
} from './engines/ninfer.ts'
export { NINFER_VRAM_MODELS, ninferVramModel } from './vram.ts'
export { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from './guidelines.ts'
export { ENGINES } from './engines.ts'
export type { EngineInfo } from './engines.ts'
export {
  ENGINE_SOURCES,
  FORK_REMOTE,
  buildEngineRepo,
  engineBuildSteps,
  engineSource,
  syncAndRebuildEngine,
  syncEngineRepo,
} from './acquire.ts'
export type {
  AcquireLog,
  EngineSource,
  EngineStepResult,
  SyncRebuildRequest,
  SyncRebuildResult,
} from './acquire.ts'
export { ENGINE_DEP_PLANS, SYSTEM_DEPS } from './deps.ts'
export { ENGINE_PLATFORM_DEFAULTS, enginePlatformDefaults } from './platform.ts'
export type { EnginePlatformDefaults } from './platform.ts'
export { BUILTIN_PRESETS, PRESET_SOURCES, extractJsonBlock } from './presets.ts'
export { DEFAULT_MODELS, defaultModelFor, defaultModelsForEngine } from './model-defaults.ts'
export {
  customArgEnv,
  customArgFlags,
  envFromSpecs,
  flagsFromSpecs,
  nodeLifecycleHost,
  pollHealth,
} from './adapters.ts'
export { HyperQwenAdapter } from './engines/hyperqwenAdapter.ts'
export { InfernixAdapter } from './engines/infernixAdapter.ts'
export { LLAMACPP_DOCKER_IMAGE, LlamaCppAdapter } from './engines/llamacppAdapter.ts'
export { NINFER_DOCKER_IMAGE, NINFER_MODEL_ARTIFACTS, NInferAdapter } from './engines/ninferAdapter.ts'
export { STRATA_DOCKER_IMAGE, StrataAdapter } from './engines/strataAdapter.ts'
export type { NInferModelArtifact } from './engines/ninferAdapter.ts'
export {
  KV_CACHE_TYPE_OPTIONS,
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from './engines/llamacpp.ts'
export type { LlamaCppModelArtifact } from './engines/llamacpp.ts'
export {
  DFLASH2_CUSTOM_VALUE,
  DFLASH2_GATE_MESSAGE,
  INFERNIX_DFLASH2_MODELS,
  INFERNIX_KV_DTYPE_OPTIONS,
  INFERNIX_MODEL_ARTIFACTS,
  INFERNIX_NGRAM_RESIDENCY_OPTIONS,
  INFERNIX_NGRAM_VOLUMES,
  INFERNIX_PARAMETERS,
  INFERNIX_REASONING_LOOP_OPTIONS,
  INFERNIX_SPEC_OPTIONS,
  SPEC_GATE_MESSAGE as INFERNIX_SPEC_GATE_MESSAGE,
  dflash2PresetOptions,
  infernixArtifactFor,
  infernixDraftModelPath,
  infernixGetDownloads,
  infernixModelKey,
} from './engines/infernix.ts'
export type {
  InfernixDFlash2Model,
  InfernixModelArtifact,
  InfernixNgramVolume,
} from './engines/infernix.ts'
export { STRATA_PARAMETERS } from './engines/strata.ts'

/**
 * Mount the providers. The NInfer measured VramModels register here so the
 * service's estimate prices a named model; the built-in hardware guidelines
 * register so the guideline engine warns on docker, host RAM, and WSL2
 * before the engine boots; the per-engine dep plans register so the deps,
 * installString, and runInstall entry points resolve a plan for every engine
 * the card offers; the built-in presets register so the defaults resolver
 * resolves a sane starting config for the detected hardware class; and the
 * engine adapters register so the launch, stop, and register entry points
 * route a plan to the adapter that rendered it.
 */
export function apply(ctx: Context): void {
  const localInfer: LocalInferService = ctx.localInfer
  for (const model of NINFER_VRAM_MODELS) {
    localInfer.registerVramModel(model)
  }
  for (const guideline of BUILTIN_GUIDELINES) {
    localInfer.registerGuideline(guideline)
  }
  for (const [engineId, plan] of Object.entries(ENGINE_DEP_PLANS)) {
    localInfer.registerDepPlan(engineId, plan)
  }
  for (const preset of BUILTIN_PRESETS) {
    localInfer.registerPreset(preset)
  }
  // The engine adapters share one lifecycle host. When DSH is in debug mode
  // (the HARNESS_LOG_LEVEL env var or the DSH logger level config), the host
  // logs every command it issues to an engine, from build to launch, through
  // the cordis logger's debug method. A normal run wires the no-debug host, so
  // the command path stays quiet.
  const host = createNodeLifecycleHost(createDshDebugLogger(ctx))
  localInfer.registerEngine(new NInferAdapter(host))
  localInfer.registerEngine(new HyperQwenAdapter(host))
  localInfer.registerEngine(new LlamaCppAdapter(host))
  localInfer.registerEngine(new InfernixAdapter(host))
  localInfer.registerEngine(new StrataAdapter(host))
}

const plugin = { name, inject, apply }
export default plugin
