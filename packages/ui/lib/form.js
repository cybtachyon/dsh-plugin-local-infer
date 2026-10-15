/**
 * FormModel is the render model the Web panel draws from: sections grouped by
 * `group`, and a field per `ParameterSpec`. The model is pure data, so the
 * panel (Phase 8) renders it without touching the domain model, and the
 * mapping from `form` kind to control kind stays unit-testable here.
 * @module dsh-plugin-local-infer/ui/form
 */
/**
 * The group label a spec without a `group` renders under.
 */
export const GENERAL_GROUP = 'General';
/**
 * Maps one `ParameterForm` to the control the panel renders for it. The
 * switch is exhaustive over the closed form union, so a new form kind is a
 * compile error until its control lands here. `hw` and `config` price a number
 * form's `sliderMax` (the host-KV pool caps the range strip at half the host
 * RAM; the KV-capacity pool caps at the live max-context value); the number
 * entry's static `max` is unaffected, so a typed value is never hard-capped by
 * the slider.
 */
export function controlFor(form, hw, config) {
    switch (form.kind) {
        case 'boolean':
            return { kind: 'checkbox' };
        case 'enum':
            return { kind: 'dropdown', options: form.options };
        case 'number': {
            const control = { kind: 'slider' };
            if (form.min !== undefined)
                control.min = form.min;
            if (form.max !== undefined)
                control.max = form.max;
            if (form.step !== undefined)
                control.step = form.step;
            if (form.unit !== undefined)
                control.unit = form.unit;
            // The slider hint is explicit: a form that names `slider: false` renders
            // the number entry without the range strip. Absent reads as a slider.
            if (form.slider === false)
                control.slider = false;
            // The priced cap only lands when the form declares it and the caller
            // passed a profile; a missing profile leaves the strip uncapped. The
            // config rides through so a cap that tracks a live field (the KV pool
            // tracking max-context) re-prices on every form render.
            if (form.sliderMax !== undefined && hw !== undefined) {
                control.sliderMax = form.sliderMax(hw, config ?? {});
            }
            return control;
        }
        case 'text':
            return {
                kind: 'text',
                ...(form.placeholder !== undefined ? { placeholder: form.placeholder } : {}),
            };
        case 'path':
            return { kind: 'picker' };
        case 'combo':
            return { kind: 'combo', options: form.options };
    }
}
/**
 * Resolves the value a field shows: the config value when the config carries
 * one, else the spec default. An explicit `undefined` in the config falls
 * through to the default, so a cleared field reverts to the spec default.
 */
export function resolveValue(spec, config) {
    const raw = config[spec.key];
    return raw === undefined ? spec.defaultValue : raw;
}
/**
 * Builds the render model for a parameter form. Sections keep first-
 * appearance order over `group`; fields keep spec order inside a section.
 * A field whose `requires` names a missing dependency renders disabled with
 * that message, which is how the form expresses cross-param gating.
 */
export function renderForm(specs, config, hw) {
    const sections = [];
    const byGroup = new Map();
    for (const spec of specs) {
        const group = spec.group ?? GENERAL_GROUP;
        let section = byGroup.get(group);
        if (section === undefined) {
            section = { group, fields: [] };
            byGroup.set(group, section);
            sections.push(section);
        }
        const reason = spec.requires ? spec.requires(config) : null;
        section.fields.push({
            key: spec.key,
            label: spec.label,
            description: spec.description,
            group,
            control: controlFor(spec.form, hw, config),
            value: resolveValue(spec, config),
            disabled: reason !== null,
            disabledReason: reason,
        });
    }
    return { sections };
}
//# sourceMappingURL=form.js.map