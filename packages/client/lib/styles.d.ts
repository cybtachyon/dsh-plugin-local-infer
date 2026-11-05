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
import type { CSSProperties } from 'react';
import type { MeterSegment, WarningTone } from 'dsh-plugin-local-infer/ui';
/** The meter segment keys the palette prices, in bar order. */
export type SegmentKey = MeterSegment['key'];
export declare const SEGMENT_COLORS: Record<SegmentKey, string>;
export declare const CARD_STYLE: CSSProperties;
export declare const ROW_STYLE: CSSProperties;
export declare const LABEL_STYLE: CSSProperties;
export declare const INPUT_STYLE: CSSProperties;
export declare const SECTION_STYLE: CSSProperties;
export declare function BANNER_STYLE(status: string): CSSProperties;
export declare function WARNING_BANNER_STYLE(tone: WarningTone): CSSProperties;
export declare function INLINE_WARNING_STYLE(tone: WarningTone): CSSProperties;
export declare const FOOTER_STYLE: CSSProperties;
export declare const BUTTON_BASE: CSSProperties;
export declare const GHOST_BUTTON: CSSProperties;
export declare const PRIMARY_BUTTON: CSSProperties;
export declare const DEPS_ROW_STYLE: CSSProperties;
export declare const INSTALL_BLOCK_STYLE: CSSProperties;
export declare const CUSTOM_ARGS_GRID_STYLE: CSSProperties;
export declare const CUSTOM_ARGS_HEADER_STYLE: CSSProperties;
export declare const CUSTOM_ARGS_BUTTONS_STYLE: CSSProperties;
export declare const SUDO_STATE_LABEL_COLOR = "var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-warning, #ff9f0a))";
export declare function HELP_BUTTON_STYLE(active: boolean): CSSProperties;
export declare const PROGRESS_STRIP_TRACK: CSSProperties;
export declare function clampPercent(percent: number): number;
export declare function progressStripFillStyle(percent: number): CSSProperties;
export declare const HELP_ROW_STYLE: CSSProperties;
//# sourceMappingURL=styles.d.ts.map
