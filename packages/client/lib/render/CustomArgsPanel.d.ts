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
import type { CustomArg } from 'dsh-plugin-local-infer/ui';
import type { TextTable } from '../text.ts';
import type { CardStore } from '../store/sync.ts';
/**
 * CustomArgAction names one row edit the Custom Arguments table runs:
 * 'key'/'value' edit a row, 'add' appends a row, 'clear' blanks the first
 * row (the permanent one), and 'remove' drops a lower row.
 */
export type CustomArgAction = 'key' | 'value' | 'add' | 'clear' | 'remove';
/**
 * normalizeCustomArgs reads the draft config's customArgs field (unknown,
 * because Config is a plain record) and returns the normalized rows: string
 * key/value pairs, with a single blank row when the field is absent, not an
 * array, or empty, so the table always has at least one row to fill.
 */
export declare function normalizeCustomArgs(raw: unknown): CustomArg[];
/**
 * nextCustomArgs applies one row edit to the draft config's customArgs field
 * and returns the next row list. It normalizes the field first, so a by-hand
 * edit never poisons the table, and keeps the at-least-one-row invariant:
 * removing the last lower row leaves a single blank row, and 'clear' blanks
 * the first row.
 */
export declare function nextCustomArgs(raw: unknown, action: CustomArgAction, index: number, value?: string): CustomArg[];
export interface CustomArgsPanelProps {
    store: CardStore;
    t: TextTable;
}
/**
 * CustomArgsPanel renders the Custom Arguments table. It reads the rows from
 * the draft config's customArgs field (the only form-value source) and
 * dispatches a draft/edit per row edit, so the rows survive a re-price and a
 * Save persists them. The help row shows while the card's help toggle is on.
 */
export declare function CustomArgsPanel(props: CustomArgsPanelProps): unknown;
//# sourceMappingURL=CustomArgsPanel.d.ts.map
