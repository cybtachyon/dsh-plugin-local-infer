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
export const name = 'local-infer-ui';
export const inject = ['localInfer'];
/**
 * The form-type-aware render model: `renderForm` maps a `ParameterSpec` list
 * and a `Config` to the sections and fields the panel draws. The panel lands
 * in Phase 8; the model is pure data the renderer tests assert on directly.
 */
export { GENERAL_GROUP, controlFor, renderForm, resolveValue, } from "./form.js";
/**
 * Mount the Web UI. The scaffold renders nothing so the bundle stays loadable;
 * the panel wiring lands in Phase 8.
 */
export function apply(ctx) {
    // The UI injects its panel, meter, and lifecycle controls here.
    void ctx;
}
const plugin = { name, inject, apply };
export default plugin;
//# sourceMappingURL=index.js.map