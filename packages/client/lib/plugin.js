/**
 * The browser card bootstrap: apply, registerCard, and mountCard.
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
 * React and @deepseek-ai/dsh-client-ui-primitives come from the shell's
 * frozen platform module table (PLATFORM_MODULES), the same baseline every
 * dynamic bundle resolves against, so the card draws the DSH selector menus,
 * buttons, checkboxes, and state dots its host Settings pages use. Hosts
 * whose table predates the primitives seed keep the native controls through
 * the require fallback in mountCard.
 * @module dsh-plugin-local-infer/client/plugin
 */
import { routeExists } from "./api/routes.js";
// The Plugins page dispatches a bundle's configuration by the bundle's
// manifest name (the root package.json "name" field, unscoped for git-URL
// installs), which is the key the package inventory uses for the
// plugins.bundle.config slot.
const PACKAGE_NAME = 'dsh-plugin-local-infer';
/**
 * The placeholder card component factory. It has the same (react, localeRef,
 * primitives) shape as the real Card so T3.8 replaces it 1:1. It renders a
 * marker element and ignores localeRef and primitives, so a missing
 * primitives seed (null) still renders.
 */
function placeholderCard(react, _localeRef, _primitives) {
    return () => react.createElement('div', { 'data-local-infer': 'placeholder' }, 'Local Infer (card under construction)');
}
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
        // The card and its route live and die together: with the host route
        // absent (no web profile) a card would only render an error, which is
        // not what a headless profile means. The probe reads any response at
        // all as proof the route exists; only a 404 or a network failure reads
        // as absent.
        routeExists().then((exists) => {
            if (!exists) {
                return;
            }
            try {
                mountCard(scope, localeRef);
            }
            catch (error) {
                console.error(`[local-infer] settings card skipped: ${error}`);
            }
        });
    });
}
/**
 * mountCard resolves the two runtime externals (react always, the primitives
 * seed with a native-control fallback) and registers the card into both
 * slots. A missing primitives seed is a fallback, not an error, so the card
 * still renders.
 */
function mountCard(ctx, localeRef) {
    let react;
    try {
        react = require('react');
    }
    catch (error) {
        console.error(`[local-infer] settings card skipped: ${error}`);
        return;
    }
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
    const Card = placeholderCard(react, localeRef, primitives);
    // slots.inject waits until a slot is declared, so each host fills the one
    // it has and the other wait never fires: from dsh 0.1.6-alpha.2 on hosts
    // declare the Plugins page's, older ones only the Settings one.
    ctx.slots.inject('plugins.bundle.config', function* () {
        yield ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card);
    });
    ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({ name: 'settings.plugin.item', id: 'local-infer', key: 'local-infer', order: 41 }, Card);
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
