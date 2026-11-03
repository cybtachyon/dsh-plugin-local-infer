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
import { react } from "./react.js";
const STYLE_ELEMENT_ID = 'dsh-local-infer-styles';
/**
 * injectStyles writes the selector pill's CSS once per document. A host
 * without a document (a test) skips the injection, and a second call finds
 * the existing element and returns.
 */
export function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = [
        '.dsh-li-selector{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-background-tertiary,rgba(128,128,128,0.12)));font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,rgba(0,0,0,0.85));cursor:pointer}',
        '.dsh-li-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.16))}',
        '.dsh-li-selector:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#0a84ff));outline-offset:2px}',
        '.dsh-li-selector:disabled{opacity:0.5;cursor:default}',
        '.dsh-li-selector-chevron{flex:none;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,0.8))}',
    ].join('\n');
    document.head.appendChild(style);
}
/**
 * SelectPill renders the pill anchor and hands it to the host's Menu as the
 * portal anchor. Selecting an item calls onSelect and closes the list.
 */
export function SelectPill(props) {
    const [open, setOpen] = react.useState(false);
    const pill = (react.createElement("button", { type: "button", className: "dsh-li-selector", disabled: props.disabled, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => {
            if (!props.disabled) {
                setOpen(!open);
            }
        } },
        props.label,
        props.Chevron ? react.createElement(props.Chevron, { className: "dsh-li-selector-chevron" }) : null));
    return (react.createElement(props.Menu, { open: open, onClose: () => {
            setOpen(false);
        }, items: props.items, selectedId: props.selectedId, onSelect: (id) => {
            props.onSelect(id);
            setOpen(false);
        }, align: "end", portal: true, anchor: pill }));
}
//# sourceMappingURL=SelectPill.js.map
