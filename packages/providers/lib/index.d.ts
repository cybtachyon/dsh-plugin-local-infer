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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "local-infer-providers";
export declare const inject: string[];
/**
 * The engine parameter surfaces, re-exported for the UI form renderer and the
 * Phase 5 adapters. NInfer's surface is CLI flags (`toArgv`); Hyper-Qwen's is
 * `.env` keys (`toEnv`).
 */
export { CTX_OPTIONS, HYPERQWEN_PARAMETERS, KV_OPTIONS, SPEC_OPTIONS as HYPERQWEN_SPEC_OPTIONS, } from './hyperqwen.ts';
export { CHAT_TEMPLATE_OPTIONS, DEVICE_PROFILE_OPTIONS, KV_DTYPE_OPTIONS, NINFER_PARAMETERS, SPEC_OPTIONS as NINFER_SPEC_OPTIONS, } from './ninfer.ts';
export { NINFER_VRAM_MODELS, ninferVramModel } from './vram.ts';
export { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from './guidelines.ts';
export { ENGINES } from './engines.ts';
export type { EngineInfo } from './engines.ts';
export { ENGINE_SOURCES, FORK_REMOTE, buildEngineRepo, engineBuildSteps, engineSource, syncAndRebuildEngine, syncEngineRepo, } from './acquire.ts';
export type { AcquireLog, EngineSource, EngineStepResult, SyncRebuildRequest, SyncRebuildResult, } from './acquire.ts';
export { ENGINE_DEP_PLANS, SYSTEM_DEPS } from './deps.ts';
export { ENGINE_PLATFORM_DEFAULTS, enginePlatformDefaults } from './platform.ts';
export type { EnginePlatformDefaults } from './platform.ts';
export { BUILTIN_PRESETS, PRESET_SOURCES, extractJsonBlock } from './presets.ts';
export { DEFAULT_MODELS, defaultModelFor, defaultModelsForEngine } from './model-defaults.ts';
export { HyperQwenAdapter, LLAMACPP_DOCKER_IMAGE, NINFER_DOCKER_IMAGE, NINFER_MODEL_ARTIFACTS, NInferAdapter, STRATA_DOCKER_IMAGE, StrataAdapter, LlamaCppAdapter, customArgEnv, customArgFlags, envFromSpecs, flagsFromSpecs, nodeLifecycleHost, pollHealth, } from './adapters.ts';
export type { NInferModelArtifact } from './adapters.ts';
export { KV_CACHE_TYPE_OPTIONS, LLAMACPP_MODEL_ARTIFACTS, LLAMACPP_PARAMETERS, llamaCppModelKey, } from './llamacpp.ts';
export type { LlamaCppModelArtifact } from './llamacpp.ts';
export { DFLASH2_GATE_MESSAGE, INFERNIX_KV_DTYPE_OPTIONS, INFERNIX_MODEL_ARTIFACTS, INFERNIX_NGRAM_RESIDENCY_OPTIONS, INFERNIX_PARAMETERS, INFERNIX_REASONING_LOOP_OPTIONS, INFERNIX_SPEC_OPTIONS, SPEC_GATE_MESSAGE as INFERNIX_SPEC_GATE_MESSAGE, infernixArtifactFor, infernixModelKey, } from './infernix.ts';
export type { InfernixModelArtifact } from './infernix.ts';
export { STRATA_PARAMETERS } from './strata.ts';
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
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map