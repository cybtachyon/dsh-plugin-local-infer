/**
 * NInfer VramModel data. The measured memory constants for the two Qwen
 * artifacts NInfer serves, ported from `docs/config-calculator.html` in the
 * NInfer fork: every byte figure is measured on an RTX 3090 (24 GiB, sm_86,
 * CUDA 12.8) against the engine's own capacity report, not estimated from
 * parameter counts. The provenance note on each model names the exact weight
 * artifact the figures apply to, because the runtime also recognizes other
 * weight profiles with different resident sizes.
 * @module @dsh/dsh-plugin-local-infer/providers/vram
 */
import type { VramModel } from '@dsh/dsh-plugin-local-infer/core';
/**
 * The NInfer measured VramModels, one per model artifact. The top-level
 * `seqFixedBytes`/`seqPerToken` are the no-speculation baseline; the
 * `speculation` table carries the per-mode terms the estimator prices, each
 * measured against the engine's own reported terms rather than borrowed from
 * the no-speculation figure.
 */
export declare const NINFER_VRAM_MODELS: readonly VramModel[];
/**
 * Resolves one NInfer VramModel by its registry id, e.g. `qwen3-27b`.
 */
export declare function ninferVramModel(modelId: string): VramModel | undefined;
//# sourceMappingURL=vram.d.ts.map