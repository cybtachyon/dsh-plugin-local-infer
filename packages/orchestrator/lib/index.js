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
import { getOrchestratorPrompt } from './config.js';
import { registerOrchestratorRoutes } from './route.js';
export { defaultOrchestratorPrompt, getOrchestratorPrompt, hasSavedOrchestratorPrompt, orchestratorConfigPath, readOrchestratorConfig, setOrchestratorPrompt, writeOrchestratorConfig, } from './config.js';
export const name = 'local-infer-orchestrator';
// No required top-level services: the `agents`, `systemPrompt`, and
// `webServer` seams are pulled with scoped injects in their own effects, so
// the component stays loadable in profiles that lack any of them.
export const inject = [];
// The section placement: the deployment persona prefix sits at 0 and the
// first centrally allocated policy section (PLAN_POLICY) at 500, so 100
// puts the Orchestrator instructions just after the persona and ahead of
// first-party guidance. dsh-system-prompt allocates nothing between 0 and
// 500, and external contributions may pick any finite order.
const orchestratorSectionOrder = 100;
/**
 * mountSeam pulls one optional service through a scoped inject and mounts
 * the half that needs it. A profile without the seam never runs the
 * callback, and a mount failure is logged and swallowed so the component
 * still loads without that half. `skipped` names the half in the catch log.
 */
function mountSeam(ctx, service, skipped, mount) {
    ctx.inject([service], (scope) => {
        try {
            mount(scope);
        }
        catch (error) {
            console.error(`[local-infer] orchestrator ${skipped}: ${error}`);
        }
    });
}
/**
 * isPrimaryAssembly reports whether a prompt assembly should receive the
 * Orchestrator prompt. Returns true when the `agents` seam never arrived
 * (no agent runtime: nothing to exclude), when `scope` is undefined (a
 * global unscoped assembly), or when the scope is one of the live
 * top-level agents; the agent object itself is the ScopeKey. Returns false
 * only for a definitively non-root scope: the empty text the gate then
 * contributes is dropped by dsh-system-prompt's renderPrompt.
 */
function isPrimaryAssembly(agents, scope) {
    return agents === undefined || scope === undefined || agents.roots().includes(scope);
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
export function apply(ctx) {
    if (typeof ctx.inject !== 'function') {
        return;
    }
    // Local holder for the registry: left undefined in profiles without
    // dsh-agent, where isPrimaryAssembly then treats every assembly as
    // primary.
    let agents;
    mountSeam(ctx, 'agents', 'agent registry skipped', (scope) => {
        agents = scope.agents;
    });
    mountSeam(ctx, 'systemPrompt', 'prompt section skipped', (scope) => {
        const systemPrompt = scope.systemPrompt;
        systemPrompt.section({
            name: 'orchestrator',
            order: orchestratorSectionOrder,
            // The prompt is user-editable text: a stray {{var}} stays literal
            // instead of failing every later prompt assembly.
            interpolate: false,
            // Provider form re-reads the holder per assembly, so a settings
            // Save reaches the next assembly without a host restart.
            text: (assembly) => isPrimaryAssembly(agents, assembly?.scope) ? getOrchestratorPrompt() : '',
        });
    });
    mountSeam(ctx, 'webServer', 'settings routes skipped', (scope) => {
        registerOrchestratorRoutes(scope);
    });
}
const plugin = { name, inject, apply };
export default plugin;
//# sourceMappingURL=index.js.map
