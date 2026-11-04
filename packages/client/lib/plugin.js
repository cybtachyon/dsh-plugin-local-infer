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
import { card } from "./Card.js";
import { orchestratorCard } from "./OrchestratorCard.js";
import { orchestratorRouteExists, routeExists } from "./api/routes.js";
import { setPrimitivesModule } from "./render/primitives.js";
import { setReactModule } from "./store/useCardStore.js";
// The Plugins page dispatches a bundle's configuration by the bundle's
// manifest name (the root package.json "name" field, unscoped for git-URL
// installs), which is the key the package inventory uses for the
// plugins.bundle.config slot.
const PACKAGE_NAME = 'dsh-plugin-local-infer';
// The plugins.row.config key: `<package name>#<row id>`, the key the Plugins
// page dispatches for the orchestrator component row (the id the bundle's
// cordis.patch.yml declares). The keyed plugins.bundle.config slot renders
// one winner per cell, so a second card cannot share the Engine card's
// cell; a component row's configuration lives in plugins.row.config.
const ORCHESTRATOR_ROW_CONFIG_KEY = PACKAGE_NAME + '#local-infer-orchestrator';
/**
 * registerCard wires the card into the host through the two optional seams,
 * each on its own scoped inject so a closure only runs where its service
 * exists. Reaching for an undeclared service throws in cordis, so each
 * optional dependency rides a scoped ctx.inject of its own.
 */
function registerCard(ctx) {
    if (typeof ctx.inject !== 'function') {
        return;
    }
    const localeRef = { current: null };
    ctx.inject(['locale'], (scope) => {
        localeRef.current = scope.locale ?? null;
        if (typeof scope.effect === 'function') {
            scope.effect(() => () => {
                localeRef.current = null;
            }, 'local-infer: locale handle');
        }
    });
    ctx.inject(['slots'], (scope) => {
        // Each card and its route live and die together: with the host route
        // absent (no web profile) a card would only render an error, which is
        // not what a headless profile means. mountWhenRouteExists owns the
        // shared read for both cards: any response at all is proof the route
        // exists, only a 404 or a network failure reads as absent.
        mountWhenRouteExists('settings card', routeExists, () => {
            mountCard(scope, localeRef);
        });
        // The orchestrator card is probed on its own: its routes belong to the
        // disabled-by-default orchestrator component row, and only an enabled
        // component mounts GET /local-infer/orchestrator, so the probe reads
        // the component's enablement. The ui row and the orchestrator row
        // toggle independently, hence the separate probe.
        mountWhenRouteExists('orchestrator settings card', orchestratorRouteExists, () => {
            mountOrchestratorCard(scope, localeRef);
        });
    });
}
/**
 * mountWhenRouteExists runs the mount only after the route probe proves the
 * host serves the card's routes, and logs the card's skip line when the
 * mount throws (a react-absent host skips the card here, not at module
 * load). Each card carries its own label and probe.
 */
function mountWhenRouteExists(label, probe, mount) {
    probe().then((exists) => {
        if (!exists) {
            return;
        }
        try {
            mount();
        }
        catch (error) {
            console.error(`[local-infer] ${label} card skipped: ${error}`);
        }
    });
}
/**
 * requireRuntimeModules resolves the two runtime externals and seeds the two
 * seams (the store's react binding, the renderers' primitives ref), so every
 * card mount draws the same resolved modules. A missing primitives seed is
 * a fallback, not an error, so the card still renders; a missing react
 * rethrows through the mount to mountWhenRouteExists, which logs the skip
 * line (a react-absent host skips the card there, not at module load).
 */
function requireRuntimeModules() {
    const reactModule = require('react');
    // The store binding (useCardStore) and the render shim read react through
    // this seam, so the bundle keeps its two runtime require calls here.
    setReactModule(reactModule);
    // The shell seeds the primitives into the frozen platform module table,
    // so the require resolves on every host that serves this page. A host
    // whose table predates the seed (or a loader that cannot materialize
    // it) keeps the native controls: a missing seed is a fallback, not an
    // error, so the card still renders.
    let primitives;
    try {
        primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    }
    catch {
        primitives = null;
    }
    if (primitives && typeof primitives.Menu !== 'function') {
        primitives = null;
    }
    // The renderers draw the seed when present and the native controls when it
    // is absent, so the resolved value (or null) is handed to them here.
    setPrimitivesModule(primitives);
    return { react: reactModule, primitives };
}
/**
 * mountCard resolves the two runtime externals and registers the Engine
 * card into both slots. A react-absent host rethrows to
 * mountWhenRouteExists, which logs the skip line.
 */
function mountCard(ctx, localeRef) {
    const modules = requireRuntimeModules();
    const Card = card(modules.react, localeRef, modules.primitives);
    // slots.inject waits until a slot is declared, so each host fills the one
    // it has and the other wait never fires: from dsh 0.1.6-alpha.2 on hosts
    // declare the Plugins page's, older ones only the Settings one. The body is
    // a plain function (the host calls it directly, the way the other bundle
    // config registrants do); a generator body is never driven, so its register
    // would not run and the card would not mount.
    ctx.slots.inject('plugins.bundle.config', () => {
        ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card);
    });
    ctx.slots.inject('settings.plugin.item', () => {
        ctx.slots.register({ name: 'settings.plugin.item', id: 'local-infer', key: 'local-infer', order: 41 }, Card);
    });
}
/**
 * mountOrchestratorCard resolves the two runtime externals and registers the
 * Orchestrator card into the plugins.row.config slot under the
 * `dsh-plugin-local-infer#local-infer-orchestrator` key: the cell the
 * Plugins page dispatches for the orchestrator component row, whose title
 * and description the component's shipped locale/en.json meta carries. No
 * settings.plugin.item registration: the older Settings page keeps the
 * Engine card alone. A react-absent host rethrows to mountWhenRouteExists,
 * which logs the skip line.
 */
function mountOrchestratorCard(ctx, localeRef) {
    const modules = requireRuntimeModules();
    const Card = orchestratorCard(modules.react, localeRef);
    ctx.slots.inject('plugins.row.config', () => {
        ctx.slots.register({ name: 'plugins.row.config', key: ORCHESTRATOR_ROW_CONFIG_KEY }, Card);
    });
}
/**
 * apply is the plugin entry point: it wires the card into the host. `slots`
 * and `locale` are both optional, so neither is required here; registerCard
 * takes each on its own scoped inject.
 */
export function apply(ctx) {
    registerCard(ctx);
}
//# sourceMappingURL=plugin.js.map
