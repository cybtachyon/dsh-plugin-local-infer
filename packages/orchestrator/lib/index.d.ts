/**
 * The Orchestrator capability: an editable "Orchestrator Prompt" persisted
 * under `~/.dsh/local-infer`, defaulted from the shipped `prompt.md`, and
 * injected into the system prompt of primary (top-level) agents while the
 * component is enabled. Sub-agent prompt assemblies receive nothing: the
 * orchestration instructions belong to the agent that delegates work, and
 * sub-agents do their focused work without them.
 *
 * The prompt store (saved file, shipped default, effective-prompt holder)
 * lives in ./config.js and is re-exported here as the single source of truth
 * the system-prompt seam and the settings routes pull from.
 * @module dsh-plugin-local-infer/orchestrator
 */
import type { Context } from '@deepseek-ai/cordis';
export { defaultOrchestratorPrompt, getOrchestratorPrompt, hasSavedOrchestratorPrompt, orchestratorConfigPath, readOrchestratorConfig, setOrchestratorPrompt, writeOrchestratorConfig, } from './config.js';
export type { StoredOrchestratorConfig } from './config.js';
export declare const name = "local-infer-orchestrator";
export declare const inject: string[];
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
     * each assembly with that assembly's context; `scope` is the opaque
     * ScopeKey of the agent the prompt is being assembled for.
     */
    section(section: {
        name: string;
        order: number;
        text: string | ((context?: {
            scope?: object;
        }) => string);
        interpolate?: boolean;
    }): () => void;
}
/**
 * AgentRegistryService narrows the dsh-agent service named `agents` to the
 * one member this package uses. dsh-agent is not a dependency here, so the
 * scoped inject casts the scope locally (same pattern as the
 * SystemPromptService narrowing above).
 */
export interface AgentRegistryService {
    /** All live top-level (primary) agents, in registration order. */
    roots(): readonly object[];
}
/**
 * Mount the Orchestrator prompt. The scoped `agents` inject captures the
 * live agent registry that gates the prompt to primary agents, so it is
 * pulled first. The scoped `systemPrompt` inject registers the one global
 * `orchestrator` section where the seam exists, injecting only into
 * primary-agent assemblies; the effect scope ties the registration to the
 * plugin, so it unregisters with the plugin. The scoped `webServer` inject
 * registers the /local-infer/ orchestrator settings routes where that seam
 * exists, so a headless profile keeps no routes.
 */
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map
