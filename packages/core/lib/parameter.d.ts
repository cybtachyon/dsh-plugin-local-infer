import type { Config } from './config.ts';
import type { EstimateContext, VramContribution } from './estimator.ts';
import type { HardwareProfile } from './hardware.ts';
/**
 * EnumOption is one choice in an enum form. `note` carries the free-form
 * tradeoff text, e.g. "rk4v4: the context choice, 31% smaller than rk8v4".
 */
export interface EnumOption {
    value: string;
    label: string;
    note?: string;
}
/**
 * ComboOption is one known choice in a combo form (dropdown plus free text).
 * `source` tags where the option came from ('engine' | 'popular' | 'added'),
 * so the renderer can group and order its entries, and 'added' marks the
 * user-typed values the plugin persists for re-selection.
 */
export interface ComboOption {
    value: string;
    label: string;
    note?: string;
    source?: 'engine' | 'popular' | 'added';
}
/**
 * ConstraintResult is the answer to a parameter's hardwareConstraint probe:
 * ok, or a severity and a human-readable message naming the fix.
 */
export type ConstraintResult = {
    ok: true;
} | {
    ok: false;
    severity: 'warn' | 'error';
    message: string;
};
/**
 * ParameterForm is the closed union of control kinds the renderer switches on:
 * checkbox, dropdown, slider plus number, text, a directory/file picker, and a
 * dropdown plus free-text combo for known-options fields (the chat template).
 *
 * A number form carries two optional render hints. `slider` (default true)
 * turns the paired range control off, leaving a plain number entry for fields
 * like a port where a 1..65535 drag strip is noise. `sliderMax` prices the
 * range control's cap from the detected hardware and the live config (the
 * host-KV pool caps at half the host RAM; the KV-capacity pool caps at the
 * max-context value) while the paired number entry keeps the form's static
 * `max` (or none), so a typed value is never hard-capped by the slider.
 */
export type ParameterForm = {
    kind: 'boolean';
} | {
    kind: 'enum';
    options: EnumOption[];
} | {
    kind: 'number';
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    slider?: boolean;
    sliderMax?: (hw: HardwareProfile, config: Config) => number;
} | {
    kind: 'text';
    placeholder?: string;
} | {
    kind: 'path';
} | {
    kind: 'combo';
    options: ComboOption[];
};
/**
 * ParameterSpec is the unit of parameter management: a declarative description
 * of one engine parameter. It is the object that makes the parameter-to-
 * hardware relationship first-class. A parameter declares its VRAM
 * contribution and its hardware constraint; the estimator and the guideline
 * engine consume those declarations. Adding a new engine or model is a matter
 * of adding these specs, never rewiring the core.
 *
 * `description` is behavior-first: it says what the parameter does to the run,
 * not what it is. `toArgv` and `toEnv` are the engine-specific spellings that
 * turn a value into a CLI flag or an environment variable.
 */
export interface ParameterSpec {
    key: string;
    label: string;
    description: string;
    form: ParameterForm;
    defaultValue?: unknown;
    group?: string;
    vramContribution?: (value: unknown, ctx: EstimateContext) => VramContribution;
    hardwareConstraint?: (value: unknown, hw: HardwareProfile) => ConstraintResult;
    requires?: (config: Config) => string | null;
    toArgv?: (value: unknown) => string[];
    toEnv?: (value: unknown) => [string, string];
}
//# sourceMappingURL=parameter.d.ts.map