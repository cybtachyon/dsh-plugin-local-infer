/**
 * The VRAM Est. meter: the to-scale segmented bar (weights / KV / overhead /
 * workspace / free / OS reserve) against the full card, the segment legend,
 * the largest-fitting-context and reserve readouts, and the "Unknown
 * Engine(s)" banner that names the VRAM the detector's foreign engine
 * programs are holding.
 *
 * A pure draw of the summary's meterModel: the card renders it after every
 * re-price, and a null model (no summary yet) renders nothing.
 * @module dsh-plugin-local-infer/client/render/Meter
 */
import { SEGMENT_COLORS } from "../styles.js";
import { react } from "./react.js";
/**
 * Meter renders the VRAM Est. section. The bar segments read against the full
 * card the way the NInfer calculator draws it, with the OS reserve hatched at
 * the far end. The reserve readout names where the dark segment's value came
 * from (the 3 GiB default, a config value, a foreign engine, or the GPU-usage
 * fallback), so the readout and the bar agree.
 */
export function Meter(props) {
    const { meter, t } = props;
    if (meter === null) {
        return null;
    }
    const bar = (react.createElement("div", { style: {
            display: 'flex',
            height: 14,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
        } }, meter.segments.map((segment) => (react.createElement("div", { key: segment.key, title: segment.label + ': ' + (segment.bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB', style: {
            width: segment.percent + '%',
            background: segment.key === 'reserve'
                ? 'repeating-linear-gradient(45deg, ' +
                    SEGMENT_COLORS.reserve +
                    ', ' +
                    SEGMENT_COLORS.reserve +
                    ' 4px, #4d4d4d 4px, #4d4d4d 8px)'
                : SEGMENT_COLORS[segment.key] || '#ccc',
        } })))));
    const legend = (react.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8, fontSize: 11 } }, meter.segments.map((segment) => (react.createElement("span", { key: segment.key, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        react.createElement("span", { style: {
                width: 8,
                height: 8,
                borderRadius: 2,
                background: SEGMENT_COLORS[segment.key] || '#ccc',
                display: 'inline-block',
            } }),
        segment.label)))));
    const sourceLabel = meter.source === 'measured'
        ? t.meterSourceMeasured
        : meter.source === 'estimated'
            ? t.meterSourceEstimated
            : t.meterSourceNotMeasured;
    // The reserve readout names where the dark segment's value came from:
    // the 3 GiB default, a config value, a foreign engine the probe
    // detected by process, or the 75%-GPU-usage fallback. The value is the
    // reserve segment's byte count, so the readout and the bar agree.
    const reserveSegment = meter.segments.find((segment) => segment.key === 'reserve') ?? null;
    const reserveSourceLabel = meter.reserveSource === 'foreign-process'
        ? t.reserveForeign
        : meter.reserveSource === 'gpu-usage'
            ? t.reserveGpuBusy
            : meter.reserveSource === 'explicit'
                ? t.reserveExplicit
                : t.reserveDefault;
    const readout = (react.createElement("div", { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))' } },
        react.createElement("span", null, t.largestContext + ': '),
        meter.largestFittingContext !== null ? (react.createElement("strong", null, String(meter.largestFittingContext) + ' ' + t.tokens)) : (react.createElement("span", null, "\u2014")),
        react.createElement("span", null, '  ·  ' + sourceLabel),
        react.createElement("div", { style: { marginTop: 2 } },
            react.createElement("span", null, t.reserveReadout + ': '),
            react.createElement("span", null, (reserveSegment ? (reserveSegment.bytes / 1024 / 1024 / 1024).toFixed(2) : '0.00') +
                ' GiB ' +
                reserveSourceLabel))));
    // The "Unknown Engine(s)" section: a yellow readout that names the VRAM
    // the detector's foreign engine programs are holding, so the user sees
    // the footprint a provider launched in another session is eating off
    // the card. Absent when no provider reads as unsure.
    const unknownEngines = meter.unknownEngines !== null ? (react.createElement("div", { style: {
            marginTop: 8,
            padding: '6px 8px',
            borderRadius: 6,
            fontSize: 12,
            background: 'var(--dsw-alias-fill-warning, rgba(255,199,0,0.12))',
            border: '1px solid var(--dsw-alias-border-warning, rgba(255,199,0,0.4))',
            color: 'var(--dsw-alias-label-warning, #b45309)',
        } },
        react.createElement("div", { style: { fontWeight: 600, marginBottom: 2 } }, t.unknownEnginesTitle),
        react.createElement("span", null, (meter.unknownEngines.bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB ' + t.unknownEnginesBody))) : null;
    return (react.createElement("div", { style: { marginTop: 8 } },
        react.createElement("div", { style: { fontWeight: 600, fontSize: 12, marginBottom: 6 } }, t.meterTitle),
        bar,
        legend,
        readout,
        unknownEngines));
}
//# sourceMappingURL=Meter.js.map
