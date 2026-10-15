/**
 * The Web UI for the local-inference capability: the form-type-aware parameter
 * form (checkbox, dropdown, slider, text, picker), the live VRAM Est. meter,
 * the red hardware-warning banner, the register-as-model confirmation (the
 * register and unregister routes the card's DSH model row talks to), and the
 * engine lifecycle controls (build / deploy / stop).
 *
 * The render models (form, meter, warnings) are pure data the panel draws
 * from; Phase 8 wires them into one panel with the lifecycle controls.
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
export { renderDeps } from './deps.ts';
export type { ChatTemplateDepModel, DepItemModel, DepsModel } from './deps.ts';
export { renderWarnings, toneFor } from './warnings.ts';
export type { WarningBannerModel, WarningModel, WarningsModel, WarningTone, } from './warnings.ts';
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