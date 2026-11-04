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
import type { Context } from '@deepseek-ai/cordis';
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
