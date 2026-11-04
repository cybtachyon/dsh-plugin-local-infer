/**
 * The guarded primitive renderers: the card's select, button, checkbox,
 * state dot, throbber, and process button, each drawing the DSH primitives
 * seed when the host provides it and the native control it replaces
 * otherwise.
 *
 * The primitives seed (the shell's @deepseek-ai/dsh-client-ui-primitives) is
 * resolved once by the bootstrap (mountCard) and handed in through
 * setPrimitivesModule. A missing seed is a fallback, not an error: the ref
 * stays null and every renderer draws its native control, so the card renders
 * on a host whose platform table predates the seed.
 * @module dsh-plugin-local-infer/client/render/primitives
 */
import { GHOST_BUTTON, HELP_ROW_STYLE, INPUT_STYLE, PRIMARY_BUTTON, PROGRESS_STRIP_TRACK, progressStripFillStyle, } from "../styles.js";
import { react } from "./react.js";
import { injectStyles, SelectPill } from "./SelectPill.js";
// The seed the bootstrap resolved. It stays null until setPrimitivesModule
// runs, so a render before the bootstrap wired it draws the native controls.
let primitivesRef = null;
/**
 * setPrimitivesModule hands the bootstrap's resolved primitives seed to the
 * renderers. mountCard calls it after its require of the seed, passing null
 * when the seed is absent (the native-control fallback).
 */
export function setPrimitivesModule(primitives) {
    primitivesRef = primitives;
}
/** getPrimitivesModule returns the resolved seed, or null for the fallback. */
export function getPrimitivesModule() {
    return primitivesRef;
}
// The per-field description line: it sits under the input column in the
// tertiary label the disabled reason reads, so a two-line description stays a
// quiet annotation. An empty text renders nothing.
export function renderHelpRow(text) {
    if (text === null || text === undefined || text === '') {
        return null;
    }
    return react.createElement("div", { style: HELP_ROW_STYLE }, text);
}
// The DSH Button atom (the --dsw-alias-button-* token families) with the
// card's inline button as the fallback a host without the seed keeps.
export function renderButton(variant, buttonProps, children) {
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.Button === 'function') {
        return react.createElement(primitives.Button, { variant, size: 'sm', type: 'button', ...buttonProps }, children);
    }
    return react.createElement('button', { type: 'button', style: variant === 'primary' ? PRIMARY_BUTTON : GHOST_BUTTON, ...buttonProps }, children);
}
export function renderCheckbox(checkboxProps) {
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.Checkbox === 'function') {
        return react.createElement(primitives.Checkbox, checkboxProps);
    }
    return (react.createElement("label", { style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
        } },
        react.createElement("input", { type: "checkbox", checked: checkboxProps.checked, disabled: checkboxProps.disabled, onChange: (event) => checkboxProps.onChange(event.target.checked) }),
        checkboxProps.label));
}
// The DSH StateDot semantics for the dep rows, with the card's colored glyphs
// as the fallback.
export function renderStateDot(state) {
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.StateDot === 'function') {
        return react.createElement(primitives.StateDot, { state });
    }
    const glyph = {
        done: '✓',
        warning: '○',
        error: '✗',
        ongoing: '…',
        idle: '○',
    };
    const color = {
        done: '#34c38f',
        warning: 'var(--dsw-alias-label-warning, #ff9f0a)',
        error: 'var(--dsw-alias-label-error, #ff3b30)',
        ongoing: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
        idle: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    };
    return (react.createElement("span", { style: { color: color[state] || 'inherit', width: 12, flex: 'none' }, "aria-hidden": "true" }, glyph[state] || '○'));
}
// The DSH loading indicator the per-entry Launch button shows while a launch
// is in flight: the StateDot ongoing spinner (the primitives' shared loader)
// with a CSS border-spin as the fallback a host without the seed keeps.
export function renderThrobber() {
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.StateDot === 'function') {
        return react.createElement(primitives.StateDot, { state: 'ongoing', size: 12 });
    }
    return (react.createElement("span", { style: {
            display: 'inline-block',
            width: 12,
            height: 12,
            border: '2px solid rgba(127,127,127,0.3)',
            borderTopColor: 'var(--dsw-alias-label-primary, #1d1d1f)',
            borderRadius: '50%',
            animation: 'dsh-local-infer-spin 0.8s linear infinite',
        }, "aria-hidden": "true" }));
}
// The 'getting' control's thin progress strip: the seed Progress when the
// host provides one (the current primitives package exports no Progress, so
// the guard stays a fallback for a future seed), the native track-and-fill
// divs on the --dsw tokens otherwise. A null state renders nothing: the
// readout alone carries the branch before the first bar update lands.
export function renderProgressStrip(progress) {
    if (progress === null || progress === undefined) {
        return null;
    }
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.Progress === 'function') {
        return react.createElement(primitives.Progress, { value: progress.percent });
    }
    return (react.createElement("div", { style: PROGRESS_STRIP_TRACK, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.max(0, Math.min(100, progress.percent)) },
        react.createElement("div", { style: progressStripFillStyle(progress.percent) })));
}
export function renderProcessButton(opts) {
    if (opts.busy === true) {
        return (react.createElement("button", { type: "button", disabled: true, style: { display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7, ...GHOST_BUTTON }, "aria-label": opts.busyLabel },
            renderThrobber(),
            react.createElement("span", null, opts.busyLabel)));
    }
    return renderButton(opts.variant, { onClick: opts.onClick, disabled: opts.disabled === true }, opts.label);
}
export function renderSelect(opts) {
    const primitives = getPrimitivesModule();
    if (primitives && typeof primitives.Menu === 'function') {
        injectStyles();
        return react.createElement(SelectPill, {
            Menu: primitives.Menu,
            Chevron: primitives.IconChevronDownOutlineRegular,
            label: opts.label,
            items: opts.items,
            selectedId: opts.value,
            onSelect: opts.onSelect,
            disabled: opts.disabled === true,
            id: opts.id,
        });
    }
    return react.createElement('select', {
        style: INPUT_STYLE,
        value: opts.value,
        disabled: opts.disabled === true,
        onChange: (event) => opts.onSelect(event.target.value),
        ...(opts.disabled === true ? { opacity: 0.5 } : {}),
        ...(opts.id !== undefined ? { id: opts.id } : {}),
    }, ...opts.items.map((item) => react.createElement('option', { key: item.id, value: item.id }, item.label)));
}
//# sourceMappingURL=primitives.js.map
