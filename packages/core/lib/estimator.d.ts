import type { Config } from './config.ts';
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
 * the UI never reads an estimate as authoritative.
 */
export interface VramModel {
    weightsBytes: number;
    workspaceBytes: number | ((ctx: number) => number);
    kvBytesPerToken: Record<string, number>;
    seqFixedBytes: number;
    seqPerToken: number;
    speculation?: Record<string, SpeculationTerms>;
    nativeMaxContext: number;
    source: 'measured' | 'estimated';
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
//# sourceMappingURL=estimator.d.ts.map