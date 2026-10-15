/**
 * FormModel is the render model the Web panel draws from: sections grouped by
 * `group`, and a field per `ParameterSpec`. The model is pure data, so the
 * panel (Phase 8) renders it without touching the domain model, and the
 * mapping from `form` kind to control kind stays unit-testable here.
 * @module @dsh/dsh-plugin-local-infer/ui/form
 */
import type { ComboOption, Config, EnumOption, HardwareProfile, ParameterForm, ParameterSpec } from '@dsh/dsh-plugin-local-infer/core';
/**
 * The control kinds the panel switches on: checkbox, dropdown, slider plus
 * number input, text, a directory/file picker, and a dropdown plus free-text
 * combo. The mapping from `ParameterForm` to a control is the form-type
 * awareness the plan requires; a new form kind is a new control, never a new
 * renderer branch per engine.
 *
 * A slider control carries `slider` (false renders the number entry without
 * the range strip, the port field's case) and `sliderMax` (the hardware-priced
 * cap for the range strip, distinct from the number entry's static `max`).
 */
export type FormControl = {
    kind: 'checkbox';
} | {
    kind: 'dropdown';
    options: readonly EnumOption[];
} | {
    kind: 'slider';
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    slider?: boolean;
    sliderMax?: number;
} | {
    kind: 'text';
    placeholder?: string;
} | {
    kind: 'picker';
} | {
    kind: 'combo';
    options: readonly ComboOption[];
};
/**
 * One rendered field. `value` resolves the config value over the spec
 * default; `disabled` plus `disabledReason` carry the `requires` cross-param
 * dependency message the form shows while the field is greyed out.
 */
export interface FormFieldModel {
    key: string;
    label: string;
    description: string;
    group: string;
    control: FormControl;
    value: unknown;
    disabled: boolean;
    disabledReason: string | null;
}
/**
 * A form section: one `group` and its fields in spec order.
 */
export interface FormSectionModel {
    group: string;
    fields: FormFieldModel[];
}
/**
 * The whole form: sections in first-appearance order. Specs without a
 * `group` render under `General`.
 */
export interface FormModel {
    sections: FormSectionModel[];
}
/**
 * The group label a spec without a `group` renders under.
 */
export declare const GENERAL_GROUP = "General";
/**
 * Maps one `ParameterForm` to the control the panel renders for it. The
 * switch is exhaustive over the closed form union, so a new form kind is a
 * compile error until its control lands here. `hw` and `config` price a number
 * form's `sliderMax` (the host-KV pool caps the range strip at half the host
 * RAM; the KV-capacity pool caps at the live max-context value); the number
 * entry's static `max` is unaffected, so a typed value is never hard-capped by
 * the slider.
 */
export declare function controlFor(form: ParameterForm, hw?: HardwareProfile, config?: Config): FormControl;
/**
 * Resolves the value a field shows: the config value when the config carries
 * one, else the spec default. An explicit `undefined` in the config falls
 * through to the default, so a cleared field reverts to the spec default.
 */
export declare function resolveValue(spec: ParameterSpec, config: Config): unknown;
/**
 * Builds the render model for a parameter form. Sections keep first-
 * appearance order over `group`; fields keep spec order inside a section.
 * A field whose `requires` names a missing dependency renders disabled with
 * that message, which is how the form expresses cross-param gating.
 */
export declare function renderForm(specs: readonly ParameterSpec[], config: Config, hw?: HardwareProfile): FormModel;
//# sourceMappingURL=form.d.ts.map