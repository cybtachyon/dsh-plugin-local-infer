import type { Config } from './config.ts';
import type { HardwareProfile } from './hardware.ts';
import type { ParameterSpec } from './parameter.ts';
/**
 * SpeculationTerms are the extra memory terms a speculative-decoding backend
 * (mtp, dflash, dflash2) adds on top of the base KV cache: a KV ratio and a
 * per-token extra, the CUDA-graph allowance, the per-sequence overhead, and any
 * draft companion weights.
 */
export interface SpeculationTerms {
    kvRatio: number;
    kvExtraPerToken: number;
    graphBytes?: (ctx: number) => number;
    seqFixedBytes?: number;
    seqPerToken?: number;
    weightsGiB?: number;
}
/**
 * VramModel is the measured (or model-card-derived) memory model for one engine
 * and model. `source` distinguishes a measured constant set from an estimate so
 * the UI never reads an estimate as authoritative. `id` keys the model in the
 * service registry, and `specKey` maps the engine's spec config values onto the
 * measured speculation entries (a mode a model never measured maps to
 * undefined, which the estimator reports as not-measured rather than pricing
 * it silently).
 */
export interface VramModel {
    id: string;
    weightsBytes: number;
    workspaceBytes: number | ((ctx: number) => number);
    kvBytesPerToken: Record<string, number>;
    seqFixedBytes: number;
    seqPerToken: number;
    speculation?: Record<string, SpeculationTerms>;
    nativeMaxContext: number;
    source: 'measured' | 'estimated';
    specKey?: (config: Config) => string | undefined;
}
/**
 * EstimateContext carries the resolved values the estimator needs to price a
 * parameter's VRAM contribution: the active KV dtype, the context length, the
 * speculation mode, and the full config for cross-parameter terms.
 */
export interface EstimateContext {
    kvDtype: string;
    ctx: number;
    spec?: string;
    config?: Config;
}
/**
 * VramContribution is the memory a single parameter adds, broken into the same
 * buckets the estimator sums: KV cache, per-sequence overhead, weights, and
 * workspace.
 */
export interface VramContribution {
    kv?: number;
    overhead?: number;
    weights?: number;
    workspace?: number;
}
/**
 * VramBreakdown is the estimator's full accounting: each memory bucket, the
 * usable budget, the total, and the largest context that fits.
 */
export interface VramBreakdown {
    weights: number;
    kv: number;
    overhead: number;
    workspace: number;
    free: number;
    reserve: number;
    total: number;
    usable: number;
    largestFittingContext: number | null;
}
/**
 * VramVerdict is the estimator's one-word answer: fits, tight, over, or
 * not-measured (no VramModel available).
 */
export interface VramVerdict {
    status: 'fits' | 'tight' | 'over' | 'not-measured';
    detail: string;
}
/**
 * VramEstimate is the estimator's complete answer: the breakdown, the verdict,
 * and the source the numbers came from, so the meter labels measured versus
 * estimated and never reads an estimate as authoritative.
 */
export interface VramEstimate {
    breakdown: VramBreakdown;
    verdict: VramVerdict;
    source: 'measured' | 'estimated' | 'not-measured';
}
/**
 * The paged KV allocator reserves whole 64-token physical pages, so a
 * requested context prices the page it rounds up to, and a solved maximum
 * context lands on a page boundary the engine can actually reach.
 */
export declare const KV_PAGE_TOKENS = 64;
/**
 * Headroom below this marks a fit as tight: it fits, but fragmentation can
 * push it over.
 */
export declare const TIGHT_HEADROOM_BYTES: number;
/**
 * pageRoundUp rounds a token count up to the 64-token page boundary the
 * paged KV allocator reserves.
 */
export declare function pageRoundUp(tokens: number): number;
/**
 * The OS-reserve budget the estimator prices when the config names none:
 * 3 GiB, the working-set floor the desktop keeps on a GPU card. An explicit
 * config value (reserveMiB or reserveGiB) always wins over the default.
 */
export declare const DEFAULT_OS_RESERVE_MIB: number;
/**
 * estimateVram prices a config against a VramModel and a HardwareProfile. It
 * is a pure function, so the meter, the guidelines, and the DSH contextWindow
 * all derive from the same arithmetic and cannot disagree. The formula mirrors
 * the NInfer config calculator: the KV cache prices its rounded page, the
 * sequence state adds its fixed block plus per-token remainder, the weights
 * gain the speculation mode's draft companion weights, and the workspace gains
 * the mode's CUDA-graph allowance. Optional parameter contributions sum on top
 * of the model terms, bucket by bucket.
 */
export declare function estimateVram(model: VramModel | undefined, config: Config, hw: HardwareProfile, specs?: readonly ParameterSpec[]): VramEstimate;
//# sourceMappingURL=estimator.d.ts.map