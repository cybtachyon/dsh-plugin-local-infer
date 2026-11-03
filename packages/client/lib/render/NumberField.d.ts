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
export interface NumberFieldField {
    key: string;
    value: number | undefined;
    disabled?: boolean;
}
export interface NumberFieldControl {
    min?: number;
    max?: number;
    step?: number;
}
export interface NumberFieldProps {
    field: NumberFieldField;
    control: NumberFieldControl;
    onValue: (key: string, value: number | undefined) => void;
}
/**
 * NumberField renders the number input for a slider field. Typing commits
 * only in-range values (out-of-range and partial text commit on blur), an
 * empty field commits undefined (the spec default), and a value that lands
 * from outside (a save, a discard, an engine switch) resyncs the text.
 */
export declare function NumberField(props: NumberFieldProps): unknown;
//# sourceMappingURL=NumberField.d.ts.map
