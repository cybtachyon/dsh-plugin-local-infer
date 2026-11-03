/**
 * The DSH-style dropdown: the selector pill anchor plus the host's Menu
 * (the same component the Settings (General) language row opens), portaled
 * to document.body so the card's overflow never crops the list.
 *
 * The Menu list itself carries the host's own CSS, so the pill is the only
 * chrome the card adds (injectStyles). The component keeps one hook state
 * (the open flag) per field, so it is defined at module level, not inside a
 * render function.
 * @module dsh-plugin-local-infer/client/render/SelectPill
 */
import type { ComponentType } from 'react';
type ComponentLike = ComponentType<Record<string, unknown>>;
export interface SelectItem {
    id: string;
    label: string;
}
export interface SelectPillProps {
    Menu: ComponentLike;
    Chevron?: ComponentLike;
    label: string;
    items: SelectItem[];
    selectedId: string;
    onSelect: (id: string) => void;
    disabled?: boolean;
    id?: string;
}
/**
 * injectStyles writes the selector pill's CSS once per document. A host
 * without a document (a test) skips the injection, and a second call finds
 * the existing element and returns.
 */
export declare function injectStyles(): void;
/**
 * SelectPill renders the pill anchor and hands it to the host's Menu as the
 * portal anchor. Selecting an item calls onSelect and closes the list.
 */
export declare function SelectPill(props: SelectPillProps): unknown;
export {};
//# sourceMappingURL=SelectPill.d.ts.map
