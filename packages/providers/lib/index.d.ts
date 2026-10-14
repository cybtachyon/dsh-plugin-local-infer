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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "local-infer-providers";
export declare const inject: string[];
/**
 * The engine parameter surfaces, re-exported for the UI form renderer and the
 * Phase 5 adapters. NInfer's surface is CLI flags (`toArgv`); Hyper-Qwen's is
 * `.env` keys (`toEnv`).
 */
export { CTX_OPTIONS, HYPERQWEN_PARAMETERS, KV_OPTIONS, SPEC_OPTIONS as HYPERQWEN_SPEC_OPTIONS, } from './hyperqwen.ts';
export { DEVICE_PROFILE_OPTIONS, KV_DTYPE_OPTIONS, NINFER_PARAMETERS, SPEC_OPTIONS as NINFER_SPEC_OPTIONS, } from './ninfer.ts';
export { NINFER_VRAM_MODELS, ninferVramModel } from './vram.ts';
export { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from './guidelines.ts';
export { ENGINES } from './engines.ts';
export type { EngineInfo } from './engines.ts';
export { ENGINE_DEP_PLANS, SYSTEM_DEPS } from './deps.ts';
/**
 * Mount the providers. The NInfer measured VramModels register here so the
 * service's estimate prices a named model; the built-in hardware guidelines
 * register so the guideline engine warns on docker, host RAM, and WSL2
 * before the engine boots; the per-engine dep plans register so the deps,
 * installString, and runInstall entry points resolve a plan for every engine
 * the card offers. The engine adapters and presets land in later phases.
 */
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map