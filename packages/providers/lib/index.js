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
export const name = 'local-infer-providers';
export const inject = ['localInfer'];
/**
 * The engine parameter surfaces, re-exported for the UI form renderer and the
 * Phase 5 adapters. NInfer's surface is CLI flags (`toArgv`); Hyper-Qwen's is
 * `.env` keys (`toEnv`).
 */
export { CTX_OPTIONS, HYPERQWEN_PARAMETERS, KV_OPTIONS, SPEC_OPTIONS as HYPERQWEN_SPEC_OPTIONS, } from "./hyperqwen.js";
export { DEVICE_PROFILE_OPTIONS, KV_DTYPE_OPTIONS, NINFER_PARAMETERS, SPEC_OPTIONS as NINFER_SPEC_OPTIONS, } from "./ninfer.js";
/**
 * Mount the providers. The scaffold registers nothing so the bundle stays
 * loadable; the body is where the adapter, preset, and guideline registrations
 * land in later phases.
 */
export function apply(ctx) {
    // Providers register their engines, presets, and guidelines here.
    void ctx;
}
const plugin = { name, inject, apply };
export default plugin;
//# sourceMappingURL=index.js.map