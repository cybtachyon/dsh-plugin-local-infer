/**
 * FormModel is the render model the Web panel draws from: sections grouped by
 * `group`, and a field per `ParameterSpec`. The model is pure data, so the
 * panel (Phase 8) renders it without touching the domain model, and the
 * mapping from `form` kind to control kind stays unit-testable here.
 * @module @dsh/dsh-plugin-local-infer/ui/form
 */
/**
 * The group label a spec without a `group` renders under.
 */
export const GENERAL_GROUP = 'General';
/**
 * Maps one `ParameterForm` to the control the panel renders for it. The
 * switch is exhaustive over the closed form union, so a new form kind is a
 * compile error until its control lands here.
 */
export function controlFor(form) {
    switch (form.kind) {
        case 'boolean':
            return { kind: 'checkbox' };
        case 'enum':
            return { kind: 'dropdown', options: form.options };
        case 'number':
            return {
                kind: 'slider',
                ...(form.min !== undefined ? { min: form.min } : {}),
                ...(form.max !== undefined ? { max: form.max } : {}),
                ...(form.step !== undefined ? { step: form.step } : {}),
                ...(form.unit !== undefined ? { unit: form.unit } : {}),
            };
        case 'text':
            return {
                kind: 'text',
                ...(form.placeholder !== undefined ? { placeholder: form.placeholder } : {}),
            };
        case 'path':
            return { kind: 'picker' };
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
export function renderForm(specs, config) {
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
            control: controlFor(spec.form),
            value: resolveValue(spec, config),
            disabled: reason !== null,
            disabledReason: reason,
        });
    }
    return { sections };
}
//# sourceMappingURL=form.js.map