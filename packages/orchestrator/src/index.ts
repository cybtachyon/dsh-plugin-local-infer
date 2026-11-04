/**
 * The Orchestrator capability: an editable "Orchestrator Prompt" persisted
 * under `~/.dsh/local-infer`, defaulted from the shipped `prompt.md`, and
 * injected into the system prompt while the component is enabled.
 *
 * In the scaffold this plugin is a no-op placeholder so the bundle loads with
 * zero contributions; the config holder lands in TASK-002, the system-prompt
 * seam in TASK-003, and the settings routes in TASK-004.
 * @module dsh-plugin-local-infer/orchestrator
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'local-infer-orchestrator'

// No required top-level services: the `systemPrompt` and `webServer` seams
// are pulled with scoped injects in their own effects, so the component
// stays loadable in profiles that lack either service.
export const inject: string[] = []

/**
 * Mount the Orchestrator prompt. The scaffold registers nothing so the bundle
 * stays loadable; the system-prompt section and the settings routes land in
 * TASK-003 and TASK-004.
 */
export function apply(ctx: Context): void {
  // The prompt holder registers its systemPrompt section and its
  // /local-infer/orchestrator routes here.
  void ctx
}

const plugin = { name, inject, apply }
export default plugin
