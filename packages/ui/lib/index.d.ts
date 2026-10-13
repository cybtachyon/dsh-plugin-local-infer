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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "local-infer-ui";
export declare const inject: string[];
/**
 * The form-type-aware render model: `renderForm` maps a `ParameterSpec` list
 * and a `Config` to the sections and fields the panel draws. The panel lands
 * in Phase 8; the model is pure data the renderer tests assert on directly.
 */
export { GENERAL_GROUP, controlFor, renderForm, resolveValue, } from './form.ts';
export type { FormControl, FormFieldModel, FormModel, FormSectionModel, } from './form.ts';
export { renderMeter } from './meter.ts';
export type { MeterModel, MeterSegment } from './meter.ts';
/**
 * Mount the Web UI. The browser card (dsh/client.js) registers into the
 * Plugins page's `plugins.bundle.config` slot and talks to the settings route
 * below; the route is registered only where a webServer exists, so a headless
 * profile keeps the service and tools untouched.
 */
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map