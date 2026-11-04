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
import type { ReactNode } from 'react';
import type { MeterModel } from 'dsh-plugin-local-infer/ui';
import type { TextTable } from '../text.ts';
export interface MeterProps {
    meter: MeterModel | null;
    t: TextTable;
}
/**
 * Meter renders the VRAM Est. section. The bar segments read against the full
 * card the way the NInfer calculator draws it, with the OS reserve hatched at
 * the far end. The reserve readout names where the dark segment's value came
 * from (the 3 GiB default, a config value, a foreign engine, or the GPU-usage
 * fallback), so the readout and the bar agree.
 */
export declare function Meter(props: MeterProps): ReactNode;
//# sourceMappingURL=Meter.d.ts.map
