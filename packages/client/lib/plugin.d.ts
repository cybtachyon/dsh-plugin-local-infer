/**
 * The browser card bootstrap: apply, registerCard, mountWhenRouteExists,
 * mountCard, and mountOrchestratorCard.
 *
 * dsh web users have no terminal, so the local-inference config (engine,
 * model, parameters) had no way in from the browser. The card is contributed
 * through a slot rather than declared as a settings schema:
 * `plugins.bundle.config`, keyed by the bundle's package name, on the Plugins
 * page from dsh 0.1.6-alpha.2 on, and `settings.plugin.item` on older hosts.
 * It reads and writes the plugin's own route (/local-infer/summary,
 * /local-infer/save), which owns ~/.dsh/local-infer/config.json, so the
 * browser never sees a value it did not store.
 *
 * The Orchestrator card is a second, independent mount: it is probed on its
 * own route (GET /local-infer/orchestrator, mounted only while the
 * disabled-by-default orchestrator component row is enabled) and registered
 * into the `plugins.row.config` slot under the
 * `dsh-plugin-local-infer#local-infer-orchestrator` key, the configuration
 * cell of that row. It shares the card's runtime-externals resolution but
 * not its store, its routes, or its slot.
 *
 * React and @deepseek-ai/dsh-client-ui-primitives come from the shell's
 * frozen platform module table (PLATFORM_MODULES), the same baseline every
 * dynamic bundle resolves against, so the card draws the DSH selector menus,
 * buttons, checkboxes, and state dots its host Settings pages use. Hosts
 * whose table predates the primitives seed keep the native controls through
 * the require fallback in the mount functions.
 * @module dsh-plugin-local-infer/client/plugin
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * The slots service is dsh-specific and absent from the cordis Context type,
 * so the card narrows the scoped context to the members it needs.
 */
export interface SlotsService {
    /**
     * Wait until the named slot is declared, then run the body. The host calls
     * the body as a plain function (the working plugins register this way), so
     * a generator body is never driven and its register would not run.
     */
    inject(name: string, body: () => void): void;
    /** Register a component into the named slot; returns the registration handle. */
    register(spec: SlotSpec, component: unknown): unknown;
}
/** The slot registration spec: the slot name plus the host-specific keys. */
export interface SlotSpec {
    name: string;
    key?: string;
    id?: string;
    order?: number;
}
/**
 * apply is the plugin entry point: it wires the card into the host. `slots`
 * and `locale` are both optional, so neither is required here; registerCard
 * takes each on its own scoped inject.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=plugin.d.ts.map
