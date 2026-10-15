/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, strata), the NInfer VramModel, the
 * built-in presets, the built-in guidelines, and the per-OS SystemDep install
 * command data. Each registers itself with `ctx.localInfer`.
 *
 * Phase 3 registers the NInfer measured VramModels and the built-in hardware
 * guidelines. The engine adapters land in Phase 5. Phase 7 registers the
 * built-in preset data (the NInfer measured and Hyper-Qwen profile presets)
 * that the defaults resolver resolves against.
 * @module dsh-plugin-local-infer/providers
 */
import { createNodeLifecycleHost, HyperQwenAdapter, LlamaCppAdapter, NInferAdapter, StrataAdapter, } from "./adapters.js";
import { createDshDebugLogger } from "./debug.js";
import { ENGINE_DEP_PLANS } from "./deps.js";
import { BUILTIN_GUIDELINES } from "./guidelines.js";
import { BUILTIN_PRESETS } from "./presets.js";
import { NINFER_VRAM_MODELS } from "./vram.js";
export const name = 'local-infer-providers';
export const inject = ['localInfer'];
/**
 * The engine parameter surfaces, re-exported for the UI form renderer and the
 * Phase 5 adapters. NInfer's surface is CLI flags (`toArgv`); Hyper-Qwen's is
 * `.env` keys (`toEnv`).
 */
export { CTX_OPTIONS, HYPERQWEN_PARAMETERS, KV_OPTIONS, SPEC_OPTIONS as HYPERQWEN_SPEC_OPTIONS, } from "./hyperqwen.js";
export { CHAT_TEMPLATE_OPTIONS, DEVICE_PROFILE_OPTIONS, KV_DTYPE_OPTIONS, NINFER_PARAMETERS, SPEC_OPTIONS as NINFER_SPEC_OPTIONS, } from "./ninfer.js";
export { NINFER_VRAM_MODELS, ninferVramModel } from "./vram.js";
export { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from "./guidelines.js";
export { ENGINES } from "./engines.js";
export { ENGINE_DEP_PLANS, SYSTEM_DEPS } from "./deps.js";
export { BUILTIN_PRESETS, PRESET_SOURCES, extractJsonBlock } from "./presets.js";
export { DEFAULT_MODELS, defaultModelFor, defaultModelsForEngine } from "./model-defaults.js";
export { HyperQwenAdapter, LLAMACPP_DOCKER_IMAGE, NINFER_DOCKER_IMAGE, NINFER_MODEL_ARTIFACTS, NInferAdapter, STRATA_DOCKER_IMAGE, StrataAdapter, LlamaCppAdapter, customArgEnv, customArgFlags, envFromSpecs, flagsFromSpecs, nodeLifecycleHost, pollHealth, } from "./adapters.js";
export { KV_CACHE_TYPE_OPTIONS, LLAMACPP_MODEL_ARTIFACTS, LLAMACPP_PARAMETERS, llamaCppModelKey, } from "./llamacpp.js";
export { STRATA_PARAMETERS } from "./strata.js";
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
export function apply(ctx) {
    const localInfer = ctx.localInfer;
    for (const model of NINFER_VRAM_MODELS) {
        localInfer.registerVramModel(model);
    }
    for (const guideline of BUILTIN_GUIDELINES) {
        localInfer.registerGuideline(guideline);
    }
    for (const [engineId, plan] of Object.entries(ENGINE_DEP_PLANS)) {
        localInfer.registerDepPlan(engineId, plan);
    }
    for (const preset of BUILTIN_PRESETS) {
        localInfer.registerPreset(preset);
    }
    // The engine adapters share one lifecycle host. When DSH is in debug mode
    // (the HARNESS_LOG_LEVEL env var or the DSH logger level config), the host
    // logs every command it issues to an engine, from build to launch, through
    // the cordis logger's debug method. A normal run wires the no-debug host, so
    // the command path stays quiet.
    const host = createNodeLifecycleHost(createDshDebugLogger(ctx));
    localInfer.registerEngine(new NInferAdapter(host));
    localInfer.registerEngine(new HyperQwenAdapter(host));
    localInfer.registerEngine(new LlamaCppAdapter(host));
    localInfer.registerEngine(new StrataAdapter(host));
}
const plugin = { name, inject, apply };
export default plugin;
//# sourceMappingURL=index.js.map