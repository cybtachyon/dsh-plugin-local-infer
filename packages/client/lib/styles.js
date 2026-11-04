/**
 * The card's style constants: the DSH design-token styles the renderers
 * draw from, ported 1:1 from the hand-written dsh/client.js.
 *
 * Every value reads a --dsw-* design token with a legacy fallback, so the
 * card sits in the page with the host's own controls and the bundle keeps
 * rendering on a host without the token family. The constants are plain
 * data (the react and ui imports are type-only and erased at bundle time),
 * so the artifact stays free of a third platform require.
 * @module dsh-plugin-local-infer/client/styles
 */
// The meter's segment palette. The bar reads against the full card the way
// the NInfer calculator draws it, with the OS reserve at the far end.
// The reserve is dark, not light: it is the card's own budget floor, not
// free space, and a light swatch read as "free" next to the free segment.
// The dark fill keeps its identity in both themes, and the hatch lines
// stay a lighter dark gray so the texture survives dark mode.
export const SEGMENT_COLORS = {
    weights: '#4f8ff7',
    kv: '#34c38f',
    // Teal, not the orange it used to be: the orange read as a warning next
    // to the workspace purple and the free gray, so the sequence-state
    // segment now sits in the cool end of the palette.
    overhead: '#14b8a6',
    workspace: '#b07ff7',
    free: '#d9d9d9',
    reserve: '#1c1c1c',
};
// The card frame reads the DSH settings-card tokens the Plugins page
// cards use (0.5px stroke, xl radius, the settings-card fill), so the
// bundle's config card sits in the page with the inventory cards. The
// legacy tokens stay as fallbacks for a host without the settings-card
// family.
export const CARD_STYLE = {
    border: '0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
    borderRadius: 'var(--dsw-radius-xl, 12px)',
    background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-background-secondary, rgba(128,128,128,0.06)))',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    fontSize: 13,
    color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.85))',
};
export const ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
};
export const LABEL_STYLE = {
    width: 120,
    flex: 'none',
    color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
};
// The input reads the DSH Input atom's field tokens (the 32px layer-1
// field with the l4 hairline), so the text rows sit in the page with the
// host's own inputs. The legacy tokens stay as fallbacks for a host
// without the layer-1 family.
//
// colorScheme is what makes the *native popups* readable: the closed
// select we style, but the open option list is browser chrome. Without
// a color-scheme declaration the browser renders that list with its
// light scheme (dark text on white) even on a dark device, which is the
// unreadable dropdown the dark-mode Plugins page showed. 'light dark'
// hands the popup to the device setting: dark list, light text, in dark
// mode; light in light mode.
export const INPUT_STYLE = {
    flex: 1,
    minWidth: 0,
    height: 32,
    padding: '0 8px',
    borderRadius: 'var(--dsw-radius-md, 8px)',
    border: '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
    background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
    color: 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    fontSize: 14,
    colorScheme: 'light dark',
};
export const SECTION_STYLE = {
    marginTop: 8,
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
};
// The VRAM verdict banner: red when the estimate is over the card's
// budget, amber when it fits.
export function BANNER_STYLE(status) {
    return {
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
        background: status === 'over'
            ? 'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))'
            : 'var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))',
        color: status === 'over'
            ? 'var(--dsw-alias-label-error, #ff3b30)'
            : 'var(--dsw-alias-label-warning, #ff9f0a)',
    };
}
// The guideline warning banner. The tone follows the worst level the
// warning model carries: red for an error, amber for a warning, neutral
// for info, the same contract the warnings render model tests pin.
export function WARNING_BANNER_STYLE(tone) {
    return {
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.5,
        background: tone === 'red'
            ? 'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))'
            : tone === 'amber'
                ? 'var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))'
                : 'var(--dsw-alias-fill-quaternary, rgba(128,128,128,0.08))',
        color: tone === 'red'
            ? 'var(--dsw-alias-label-error, #ff3b30)'
            : tone === 'amber'
                ? 'var(--dsw-alias-label-warning, #ff9f0a)'
                : 'inherit',
    };
}
// The per-field inline warning line, painted in the same tone contract
// as the banner.
export function INLINE_WARNING_STYLE(tone) {
    return {
        fontSize: 11,
        marginTop: 2,
        color: tone === 'red'
            ? 'var(--dsw-alias-label-error, #ff3b30)'
            : tone === 'amber'
                ? 'var(--dsw-alias-label-warning, #ff9f0a)'
                : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    };
}
export const FOOTER_STYLE = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
};
export const BUTTON_BASE = {
    padding: '5px 14px',
    borderRadius: 6,
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
};
export const GHOST_BUTTON = {
    ...BUTTON_BASE,
    background: 'transparent',
    color: 'inherit',
};
export const PRIMARY_BUTTON = {
    ...BUTTON_BASE,
    background: 'var(--dsw-alias-accent, #0a84ff)',
    color: '#fff',
    border: 'none',
};
// The deps panel. The install block is a copy/paste target, so it gets a
// monospace pre with its own copy button; the dep rows read their status
// from a state dot (the DSH StateDot, or its glyph fallback), not a word,
// so a long list stays scannable.
export const DEPS_ROW_STYLE = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontSize: 12,
    marginTop: 2,
};
export const INSTALL_BLOCK_STYLE = {
    margin: '8px 0',
    padding: 8,
    borderRadius: 6,
    background: 'var(--dsw-alias-background-tertiary, rgba(128,128,128,0.08))',
    border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
};
// The Custom Arguments table. A three-column grid (parameter, value, the
// + / - controls) the user fills with extra launch flags. The header row
// reads the tertiary section label; the inputs reuse the card's Input atom
// tokens, and the + / - controls are the compact ghost buttons.
export const CUSTOM_ARGS_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: 6,
    alignItems: 'center',
    marginTop: 4,
};
export const CUSTOM_ARGS_HEADER_STYLE = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
};
export const CUSTOM_ARGS_BUTTONS_STYLE = {
    display: 'flex',
    gap: 4,
    justifyContent: 'flex-end',
};
// The circular header buttons: the "?" help toggle and the refresh
// action. The active state reads as the accent fill; the inactive state
// as the muted outline. The help preference persists through the save
// route, so it survives a reload.
export function HELP_BUTTON_STYLE(active) {
    return {
        width: 20,
        height: 20,
        flex: 'none',
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        fontSize: 12,
        lineHeight: 1,
        cursor: 'pointer',
        border: '1px solid ' +
            (active
                ? 'var(--dsw-alias-accent, #0a84ff)'
                : 'var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))'),
        background: active ? 'var(--dsw-alias-accent, #0a84ff)' : 'transparent',
        color: active ? '#fff' : 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
    };
}
// The thin progress strip the 'getting' title-bar control renders: a 4px
// rounded track the download fill grows through. The track reads the layer-1
// background token the inputs read, the fill reads the accent token, so the
// strip sits in the page with the card's own controls in both themes. The
// primitives package exports no Progress component, so the strip is a custom
// native control on these tokens (render/primitives.tsx guards a future seed
// Progress member against it).
export const PROGRESS_STRIP_TRACK = {
    flex: 1,
    minWidth: 80,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
};
// progressStripFillStyle renders the strip's fill: the accent bar whose width
// is the percent complete, clamped to the 0-100 range the track spans.
export function progressStripFillStyle(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    return {
        height: '100%',
        width: clamped + '%',
        background: 'var(--dsw-alias-accent, #0a84ff)',
    };
}
// The per-field description line: it sits under the input column (the
// 120px label plus the 8px row gap) in the tertiary label the disabled
// reason reads, so a two-line description stays a quiet annotation.
export const HELP_ROW_STYLE = {
    fontSize: 11,
    lineHeight: 1.4,
    marginTop: 2,
    marginLeft: 128,
    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
};
//# sourceMappingURL=styles.js.map
