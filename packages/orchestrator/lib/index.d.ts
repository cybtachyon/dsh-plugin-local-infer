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
import type { Context } from '@deepseek-ai/cordis';
export { defaultOrchestratorPrompt, getOrchestratorPrompt, orchestratorConfigPath, readOrchestratorConfig, setOrchestratorPrompt, writeOrchestratorConfig, } from './config.js';
export type { StoredOrchestratorConfig } from './config.js';
export declare const name = "local-infer-orchestrator";
export declare const inject: string[];
/**
 * Mount the Orchestrator prompt. The scaffold registers nothing so the bundle
 * stays loadable; the system-prompt section and the settings routes land in
 * TASK-003 and TASK-004.
 */
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map
