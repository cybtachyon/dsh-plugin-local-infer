/**
 * The chat-template control, split from the old finicky free-text combo
 * into a preset dropdown (the shipped presets plus a "Custom" entry) and a
 * "Custom Chat template" text field that shows while the preset is Custom.
 * The single config value (the effective --chat-template) is derived: a
 * known preset value selects that preset, a non-preset value selects
 * Custom, and an empty value selects the blank row. The local custom-mode
 * flag keeps the text field open after a Custom selection even while the
 * value is still empty, so a fresh selection is ready to type.
 *
 * The absent-template hint (ChatTemplateStatusRow) shows while the selected
 * template is missing from the model directory: with the hf CLI detected it
 * names the download command and offers a Download button, without the CLI
 * it shows the command as copyable text. The auto-download effect
 * (useChatTemplateAutoDownload) fires that download once when the summary
 * reports an absent template the CLI can pull.
 *
 * Defined at module level, not inside a render function, so React keeps one
 * hook state per field instead of remounting on every render.
 * @module dsh-plugin-local-infer/client/render/ChatTemplateField
 */
import type { ChatTemplateStatusModel } from 'dsh-plugin-local-infer/ui';
import type { TextTable } from '../text.ts';
import type { ActionState } from '../store/types.ts';
import type { CardStore } from '../store/sync.ts';
export interface ChatTemplateFieldField {
    key: string;
    value: string | null | undefined;
    disabled?: boolean;
}
export interface ChatTemplateOption {
    value: string;
    label: string;
    note?: string;
}
export interface ChatTemplateFieldControl {
    options?: readonly ChatTemplateOption[];
}
export interface ChatTemplateFieldProps {
    field: ChatTemplateFieldField;
    control: ChatTemplateFieldControl;
    onValue: (key: string, value: string | undefined) => void;
    t: TextTable;
}
/**
 * ChatTemplateField renders the preset select and the custom text row. The
 * preset select draws through renderSelect (the DSH Menu pill, or the
 * native select a host without the seed keeps); the custom row is a plain
 * text input the user types a local path or an HF repo reference into.
 */
export declare function ChatTemplateField(props: ChatTemplateFieldProps): unknown;
export interface ChatTemplateStatusRowProps {
    status: ChatTemplateStatusModel;
    cell: ActionState;
    onDownload: () => void;
    t: TextTable;
}
/**
 * ChatTemplateStatusRow renders the absent-template hint. It shows while
 * the selected template is missing from the model directory: with the hf
 * CLI detected it names the download command and offers the Download
 * button (the auto-download effect fires it first); without the CLI it
 * shows the command as copyable text, the same command the System
 * dependencies box carries. A present template renders nothing.
 */
export declare function ChatTemplateStatusRow(props: ChatTemplateStatusRowProps): unknown;
/**
 * useChatTemplateAutoDownload fires the template download once when the
 * summary reports a selected template that is absent from the model
 * directory and the hf CLI is available, so a picked preset works out of
 * the box. A present template, a missing CLI (the System dependencies box
 * shows the command), an empty repo, and a download already in flight all
 * read as no-ops; the cell's pending guard is the double-fire protection.
 * The card owner (Card.tsx) calls the hook; the effect re-fires only when
 * the repo changes, the way the hand-written card's effect did.
 */
export declare function useChatTemplateAutoDownload(store: CardStore): void;
//# sourceMappingURL=ChatTemplateField.d.ts.map
