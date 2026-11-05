/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, infernix, strata, basalt), the NInfer
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
import { BasaltAdapter } from './engines/basalt/basaltAdapter.ts'
import { HyperQwenAdapter } from './engines/hyperqwen/hyperqwenAdapter.ts'
import { InfernixAdapter } from './engines/infernix/infernixAdapter.ts'
import { LlamaCppAdapter } from './engines/llamacpp/llamacppAdapter.ts'
import { NInferAdapter } from './engines/ninfer/ninferAdapter.ts'
import { StrataAdapter } from './engines/strata/strataAdapter.ts'
import { createDshDebugLogger } from './debug.ts'
import { ENGINE_DEP_PLANS } from './deps.ts'
import { BUILTIN_GUIDELINES } from './guidelines.ts'
import { BUILTIN_PRESETS } from './presets.ts'
import { BASALT_VRAM_MODELS, NINFER_VRAM_MODELS } from './vram.ts'

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
} from './engines/hyperqwen/hyperqwen.ts'
export {
  CHAT_TEMPLATE_OPTIONS,
  DEVICE_PROFILE_OPTIONS,
  KV_DTYPE_OPTIONS,
  NINFER_PARAMETERS,
  SPEC_OPTIONS as NINFER_SPEC_OPTIONS,
} from './engines/ninfer/ninfer.ts'
export {
  BASALT_VRAM_MODELS,
  NINFER_VRAM_MODELS,
  basaltVramModel,
  ninferVramModel,
} from './vram.ts'
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
  syncEngineForDeploy,
  syncEngineRepo,
} from './acquire.ts'
export type {
  AcquireLog,
  EngineDeploySync,
  EngineSource,
  EngineStepResult,
  SyncRebuildRequest,
  SyncRebuildResult,
  SyncStepResult,
} from './acquire.ts'
export { ENGINE_DEP_PLANS, SYSTEM_DEPS, engineLocalDeps } from './deps.ts'
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
  resolveLaunchArgv,
} from './adapters.ts'
export { HyperQwenAdapter } from './engines/hyperqwen/hyperqwenAdapter.ts'
export { InfernixAdapter } from './engines/infernix/infernixAdapter.ts'
export { LLAMACPP_DOCKER_IMAGE, LlamaCppAdapter } from './engines/llamacpp/llamacppAdapter.ts'
export { NINFER_DOCKER_IMAGE, NINFER_MODEL_ARTIFACTS, NInferAdapter } from './engines/ninfer/ninferAdapter.ts'
export { STRATA_DOCKER_IMAGE, StrataAdapter } from './engines/strata/strataAdapter.ts'
export type { NInferModelArtifact } from './engines/ninfer/ninferAdapter.ts'
export {
  KV_CACHE_TYPE_OPTIONS,
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from './engines/llamacpp/llamacpp.ts'
export type { LlamaCppModelArtifact } from './engines/llamacpp/llamacpp.ts'
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
} from './engines/infernix/infernix.ts'
export type {
  InfernixDFlash2Model,
  InfernixModelArtifact,
  InfernixNgramVolume,
} from './engines/infernix/infernix.ts'
export { STRATA_PARAMETERS } from './engines/strata/strata.ts'
export { BASALT_PARAMETERS } from './engines/basalt/basalt.ts'
export { BasaltAdapter } from './engines/basalt/basaltAdapter.ts'

/**
 * Mount the providers. The NInfer measured VramModels and the Basalt
 * estimated VramModel register here so the service's estimate prices a named
 * model; the built-in hardware guidelines register so the guideline engine
 * warns on docker, host RAM, WSL2, and the Basalt Blackwell gate before the
 * engine boots; the per-engine dep plans register so the deps, installString,
 * and runInstall entry points resolve a plan for every engine the card
 * offers; the built-in presets register so the defaults resolver resolves a
 * sane starting config for the detected hardware class; and the engine
 * adapters register so the launch, stop, and register entry points route a
 * plan to the adapter that rendered it.
 */
export function apply(ctx: Context): void {
  const localInfer: LocalInferService = ctx.localInfer
  for (const model of NINFER_VRAM_MODELS) {
    localInfer.registerVramModel(model)
  }
  for (const model of BASALT_VRAM_MODELS) {
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
  // the command path stays quiet. The sudo hook reports a waiting
  // `sudo ln -sf ...` deploy link through the service's sudo seam, so the
  // route-registered observer can show the CLI note while the card waits.
  const host = createNodeLifecycleHost(createDshDebugLogger(ctx), {
    notify: sudoAnnouncer(localInfer),
  })
  localInfer.registerEngine(new NInferAdapter(host))
  localInfer.registerEngine(new HyperQwenAdapter(host))
  localInfer.registerEngine(new LlamaCppAdapter(host))
  localInfer.registerEngine(new InfernixAdapter(host))
  localInfer.registerEngine(new StrataAdapter(host))
  localInfer.registerEngine(new BasaltAdapter(host))
}

/**
 * sudoAnnouncer adapts one service to the lifecycle host's sudo notify hook:
 * it calls notifySudoNeeded, the service's announce path into the
 * route-registered sudo observer. The published LocalInferService surface has
 * not listed the method yet, so it is read through this narrow shape; a
 * service that lacks the method gets a no-op, so the announce never fails a
 * guarded run.
 */
function sudoAnnouncer(localInfer: LocalInferService): (command: string) => void {
  const { notifySudoNeeded } = localInfer as unknown as {
    notifySudoNeeded?: (command: string) => void
  }
  if (typeof notifySudoNeeded !== 'function') return () => {}
  return (command) => notifySudoNeeded.call(localInfer, command)
}

const plugin = { name, inject, apply }
export default plugin
