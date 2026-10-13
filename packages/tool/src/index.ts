/**
 * The model-facing tools for the local-inference capability:
 * `local_infer_estimate`, `local_infer_launch`, `local_infer_status`, and
 * `local_infer_register`, each registered with its own timeout budget (launch
 * is long, estimate is fast), plus the system-prompt section that tells the
 * agent when to reach for them.
 *
 * In the scaffold this plugin is a no-op placeholder that injects the seam so
 * the bundle loads with zero tools. Phase 8 registers the four tools and the
 * prompt section.
 * @module @dsh/dsh-plugin-local-infer/tool
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'local-infer-tool'
export const inject = ['localInfer']

/**
 * Mount the model-facing tools. The scaffold registers nothing so the bundle
 * stays loadable; the tool registrations land in Phase 8.
 */
export function apply(ctx: Context): void {
  // Tools register their local_infer_* entries and prompt section here.
  void ctx
}

const plugin = { name, inject, apply }
export default plugin
