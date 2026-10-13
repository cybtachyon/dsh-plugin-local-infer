/**
 * The Web UI for the local-inference capability: the form-type-aware parameter
 * form (checkbox, dropdown, slider, text, picker), the live VRAM Est. meter,
 * the red hardware-warning banner, the engine lifecycle controls (build /
 * deploy / stop), and the register-as-model confirmation.
 *
 * In the scaffold this plugin is a no-op placeholder that injects the seam so
 * the bundle loads with no UI. Phase 8 wires the meter, warnings, lifecycle
 * controls, and register confirmation into one panel.
 * @module @dsh/dsh-plugin-local-infer/ui
 */
import { registerLocalInferRoute } from "./route.js";
export const name = 'local-infer-ui';
export const inject = ['localInfer'];
/**
 * The form-type-aware render model: `renderForm` maps a `ParameterSpec` list
 * and a `Config` to the sections and fields the panel draws. The panel lands
 * in Phase 8; the model is pure data the renderer tests assert on directly.
 */
export { GENERAL_GROUP, controlFor, renderForm, resolveValue, } from "./form.js";
export { renderMeter } from "./meter.js";
/**
 * Mount the Web UI. The browser card (dsh/client.js) registers into the
 * Plugins page's `plugins.bundle.config` slot and talks to the settings route
 * below; the route is registered only where a webServer exists, so a headless
 * profile keeps the service and tools untouched.
 */
export function apply(ctx) {
    const localInfer = ctx.localInfer;
    if (typeof ctx.inject === 'function') {
        ctx.inject(['webServer'], (scope) => {
            try {
                registerLocalInferRoute(scope, localInfer);
            }
            catch (error) {
                console.error(`[local-infer] settings route skipped: ${error}`);
            }
        });
    }
}
const plugin = { name, inject, apply };
export default plugin;
//# sourceMappingURL=index.js.map