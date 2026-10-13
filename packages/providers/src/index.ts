/**
 * The concrete providers for the local-inference capability: the engine
 * adapters (ninfer, hyperqwen, llamacpp, strata), the NInfer VramModel, the
 * built-in presets, the built-in guidelines, and the per-OS SystemDep install
 * command data. Each registers itself with `ctx.localInfer`.
 *
 * In the scaffold this plugin is a no-op placeholder that injects the seam so
 * the bundle loads with zero providers. Phase 5 fills in the adapter
 * registrations and Phase 7 the preset and guideline data.
 * @module @dsh/dsh-plugin-local-infer-providers
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'local-infer-providers'
export const inject = ['localInfer']

/**
 * Mount the providers. The scaffold registers nothing so the bundle stays
 * loadable; the body is where the adapter, preset, and guideline registrations
 * land in later phases.
 */
export function apply(ctx: Context): void {
  // Providers register their engines, presets, and guidelines here.
  void ctx
}

const plugin = { name, inject, apply }
export default plugin
