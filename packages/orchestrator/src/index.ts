/**
 * The Orchestrator capability: an editable "Orchestrator Prompt" persisted
 * under `~/.dsh/local-infer`, defaulted from the shipped `prompt.md`, and
 * injected into the system prompt while the component is enabled.
 *
 * The prompt store (saved file, shipped default, effective-prompt holder)
 * lives in ./config.js and is re-exported here as the single source of truth
 * the system-prompt seam (TASK-003) and the settings routes (TASK-004) pull
 * from.
 * @module dsh-plugin-local-infer/orchestrator
 */

import type { Context } from '@deepseek-ai/cordis'
import { getOrchestratorPrompt } from './config.js'
import { registerOrchestratorRoutes } from './route.js'
import type { WebServerService } from './route.js'

export {
  defaultOrchestratorPrompt,
  getOrchestratorPrompt,
  orchestratorConfigPath,
  readOrchestratorConfig,
  setOrchestratorPrompt,
  writeOrchestratorConfig,
} from './config.js'
export type { StoredOrchestratorConfig } from './config.js'

export const name = 'local-infer-orchestrator'

// No required top-level services: the `systemPrompt` and `webServer` seams
// are pulled with scoped injects in their own effects, so the component
// stays loadable in profiles that lack either service.
export const inject: string[] = []

/**
 * SystemPromptService narrows the dsh-system-prompt service to the one
 * member this package uses. That package augments the cordis Context with
 * `systemPrompt` and is not a dependency here, so the scoped inject casts
 * the scope locally (same shape as the ui's WebServerService narrowing).
 */
export interface SystemPromptService {
  /**
   * Registers one ordered prompt section in the calling scope and returns
   * the Cordis effect disposer. `text` may be a provider re-evaluated at
   * each assembly.
   */
  section(section: {
    name: string
    order: number
    text: string | (() => string)
    interpolate?: boolean
  }): () => void
}

// The section placement: the deployment persona prefix sits at 0 and the
// first centrally allocated policy section (PLAN_POLICY) at 500, so 100
// puts the Orchestrator instructions just after the persona and ahead of
// first-party guidance. dsh-system-prompt allocates nothing between 0 and
// 500, and external contributions may pick any finite order.
const orchestratorSectionOrder = 100

/**
 * Mount the Orchestrator prompt. The scoped `systemPrompt` inject registers
 * the one global `orchestrator` section where the seam exists; the effect
 * scope ties the registration to the plugin, so it unregisters with the
 * plugin. The scoped `webServer` inject registers the /local-infer/
 * orchestrator settings routes where that seam exists, so a headless profile
 * keeps no routes.
 */
export function apply(ctx: Context): void {
  if (typeof ctx.inject !== 'function') {
    return
  }
  ctx.inject(['systemPrompt'], (scope) => {
    const systemPrompt = (scope as Context & { systemPrompt: SystemPromptService }).systemPrompt
    try {
      systemPrompt.section({
        name: 'orchestrator',
        order: orchestratorSectionOrder,
        // The prompt is user-editable text: a stray {{var}} stays literal
        // instead of failing every later prompt assembly.
        interpolate: false,
        // Provider form re-reads the holder per assembly, so a settings
        // Save reaches the next assembly without a host restart.
        text: () => getOrchestratorPrompt(),
      })
    } catch (error) {
      console.error(`[local-infer] orchestrator prompt section skipped: ${error}`)
    }
  })
  ctx.inject(['webServer'], (scope) => {
    try {
      registerOrchestratorRoutes(scope as Context & { webServer: WebServerService })
    } catch (error) {
      console.error(`[local-infer] orchestrator settings routes skipped: ${error}`)
    }
  })
}

const plugin = { name, inject, apply }
export default plugin
