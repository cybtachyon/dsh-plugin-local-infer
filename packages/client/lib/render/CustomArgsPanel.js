/**
 * The Custom Arguments panel: a three-column table of key/value rows the
 * user fills with extra launch flags, plus the + / - controls. The rows live
 * in the draft config's `customArgs` field, so a Save persists them and the
 * next engine launch appends them to the command line. The panel is a pure
 * draw of the rows; the row edits dispatch a draft/edit, so they stay in the
 * card's draft, not the panel.
 *
 * The first row is the permanent row: its "-" clears the key and value (it
 * never disappears, so the table always has at least one row). A lower row's
 * "-" removes that row entirely. Every row's "+" appends a fresh row.
 * @module dsh-plugin-local-infer/client/render/CustomArgsPanel
 */
import { CUSTOM_ARGS_BUTTONS_STYLE, CUSTOM_ARGS_GRID_STYLE, CUSTOM_ARGS_HEADER_STYLE, INPUT_STYLE, SECTION_STYLE, } from "../styles.js";
import { react } from "./react.js";
import { renderButton, renderHelpRow } from "./primitives.js";
/**
 * normalizeCustomArgs reads the draft config's customArgs field (unknown,
 * because Config is a plain record) and returns the normalized rows: string
 * key/value pairs, with a single blank row when the field is absent, not an
 * array, or empty, so the table always has at least one row to fill.
 */
export function normalizeCustomArgs(raw) {
    if (!Array.isArray(raw)) {
        return [{ key: '', value: '' }];
    }
    const rows = raw.map((entry) => {
        const fields = entry !== null && typeof entry === 'object' ? entry : {};
        return {
            key: typeof fields.key === 'string' ? fields.key : '',
            value: typeof fields.value === 'string' ? fields.value : '',
        };
    });
    return rows.length > 0 ? rows : [{ key: '', value: '' }];
}
/**
 * nextCustomArgs applies one row edit to the draft config's customArgs field
 * and returns the next row list. It normalizes the field first, so a by-hand
 * edit never poisons the table, and keeps the at-least-one-row invariant:
 * removing the last lower row leaves a single blank row, and 'clear' blanks
 * the first row.
 */
export function nextCustomArgs(raw, action, index, value = '') {
    let args = normalizeCustomArgs(raw);
    switch (action) {
        case 'key':
            args = args.map((entry, i) => (i === index ? { ...entry, key: value } : entry));
            break;
        case 'value':
            args = args.map((entry, i) => (i === index ? { ...entry, value } : entry));
            break;
        case 'add':
            args = [...args, { key: '', value: '' }];
            break;
        case 'clear':
            args = [{ key: '', value: '' }, ...args.slice(1)];
            break;
        case 'remove':
            args = args.filter((_entry, i) => i !== index);
            if (args.length === 0) {
                args = [{ key: '', value: '' }];
            }
            break;
    }
    return args;
}
/**
 * CustomArgsPanel renders the Custom Arguments table. It reads the rows from
 * the draft config's customArgs field (the only form-value source) and
 * dispatches a draft/edit per row edit, so the rows survive a re-price and a
 * Save persists them. The help row shows while the card's help toggle is on.
 */
export function CustomArgsPanel(props) {
    const { store, t } = props;
    const state = store.getSnapshot();
    const draft = state.draft;
    const rows = normalizeCustomArgs(draft !== null ? draft.config.customArgs : undefined);
    // The row edit reads the fresh snapshot, so a re-price landing between the
    // render and the click never clobbers the rows it prices.
    const edit = (action, index, value = '') => {
        const current = store.getSnapshot().draft;
        if (current === null) {
            return;
        }
        const config = {
            ...current.config,
            customArgs: nextCustomArgs(current.config.customArgs, action, index, value),
        };
        store.dispatch({
            type: 'draft/edit',
            draft: {
                engine: current.engine,
                config,
                ...(current.platform !== undefined ? { platform: current.platform } : {}),
            },
        });
    };
    const body = rows.map((arg, index) => {
        const isFirst = index === 0;
        return (react.createElement("div", { key: 'arg-row-' + index, style: { display: 'contents' } },
            react.createElement("input", { type: "text", style: INPUT_STYLE, value: arg.key, placeholder: t.customArgKeyPlaceholder, "aria-label": t.customArgKeyHeader, onChange: (event) => edit('key', index, event.target.value) }),
            react.createElement("input", { type: "text", style: INPUT_STYLE, value: arg.value, placeholder: t.customArgValuePlaceholder, "aria-label": t.customArgValueHeader, onChange: (event) => edit('value', index, event.target.value) }),
            react.createElement("div", { style: CUSTOM_ARGS_BUTTONS_STYLE },
                renderButton('ghost', {
                    type: 'button',
                    onClick: () => edit('add', index),
                    'aria-label': t.customArgAdd,
                }, '+'),
                renderButton('ghost', {
                    type: 'button',
                    onClick: () => edit(isFirst ? 'clear' : 'remove', index),
                    'aria-label': isFirst ? t.customArgClear : t.customArgRemove,
                }, '-'))));
    });
    return (react.createElement("div", { style: { marginTop: 8 } },
        react.createElement("div", { style: SECTION_STYLE }, t.customArgsTitle),
        state.ui.help ? renderHelpRow(t.customArgHelp) : null,
        react.createElement("div", { style: { ...CUSTOM_ARGS_GRID_STYLE, gridTemplateRows: 'auto' } },
            react.createElement("div", { style: CUSTOM_ARGS_HEADER_STYLE }, t.customArgKeyHeader),
            react.createElement("div", { style: CUSTOM_ARGS_HEADER_STYLE }, t.customArgValueHeader),
            react.createElement("div", { style: { ...CUSTOM_ARGS_HEADER_STYLE, textAlign: 'right' } }, t.customArgAddRemoveHeader),
            body)));
}
//# sourceMappingURL=CustomArgsPanel.js.map
