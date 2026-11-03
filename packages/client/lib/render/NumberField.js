/**
 * The number input that pairs with a slider: type a number or use the native
 * spin buttons. It keeps the typed text in local state and commits an in-range
 * number, so a partial keystroke (a "1" on the way to "128") never pushes an
 * out-of-range value into the draft config. Spin buttons always land in range,
 * so they commit immediately.
 *
 * Defined at module level, not inside a render function, so React keeps one
 * hook state per field instead of remounting on every render.
 * @module dsh-plugin-local-infer/client/render/NumberField
 */
import { react } from "./react.js";
/**
 * NumberField renders the number input for a slider field. Typing commits
 * only in-range values (out-of-range and partial text commit on blur), an
 * empty field commits undefined (the spec default), and a value that lands
 * from outside (a save, a discard, an engine switch) resyncs the text.
 */
export function NumberField(props) {
    const { field, control, onValue } = props;
    const numeric = typeof field.value === 'number' ? field.value : null;
    const [text, setText] = react.useState(numeric !== null ? String(numeric) : '');
    // A value that lands from outside resyncs the text; the ref comparison is
    // the React adjust-state-during-render pattern, no effect cycle needed.
    const lastNumeric = react.useRef(numeric);
    if (numeric !== lastNumeric.current) {
        lastNumeric.current = numeric;
        setText(numeric !== null ? String(numeric) : '');
    }
    const snap = (value) => {
        if (!control.step || control.step <= 0) {
            return value;
        }
        const base = control.min !== undefined ? control.min : 0;
        const steps = Math.round((value - base) / control.step);
        // 1e6 kills float noise (0.05 * 18 = 0.9000000000000001).
        return Math.round((base + steps * control.step) * 1e6) / 1e6;
    };
    const commit = () => {
        if (text === '') {
            return; // an empty field already committed undefined
        }
        const parsed = Number(text);
        if (Number.isNaN(parsed)) {
            setText(numeric !== null ? String(numeric) : '');
            return;
        }
        let clamped = parsed;
        if (control.min !== undefined && clamped < control.min) {
            clamped = control.min;
        }
        if (control.max !== undefined && clamped > control.max) {
            clamped = control.max;
        }
        clamped = snap(clamped);
        setText(String(clamped));
        if (clamped !== numeric) {
            onValue(field.key, clamped);
        }
    };
    return (react.createElement("input", { type: "number", min: control.min, max: control.max, step: control.step, value: text, disabled: field.disabled, style: {
            width: 88,
            flex: 'none',
            height: 32,
            padding: '0 8px',
            borderRadius: 'var(--dsw-radius-md, 8px)',
            border: '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
            background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            font: 'inherit',
            fontSize: 14,
            colorScheme: 'light dark',
            opacity: field.disabled ? 0.5 : 1,
        }, onChange: (event) => {
            const raw = event.target.value;
            setText(raw);
            if (raw === '') {
                // Clearing the field reverts to the spec default, the same
                // fall-through resolveValue documents.
                onValue(field.key, undefined);
                return;
            }
            const parsed = Number(raw);
            if (Number.isNaN(parsed)) {
                return; // a partial like "1e"; commit on blur
            }
            if (control.min !== undefined && parsed < control.min) {
                return; // out of range while typing; commit on blur
            }
            if (control.max !== undefined && parsed > control.max) {
                return;
            }
            const snapped = snap(parsed);
            setText(String(snapped));
            onValue(field.key, snapped);
        }, onBlur: commit, onKeyDown: (event) => {
            if (event.key === 'Enter') {
                commit();
            }
        } }));
}
//# sourceMappingURL=NumberField.js.map
