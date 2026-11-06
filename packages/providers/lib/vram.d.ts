/**
 * VramModel data for the engines the card prices. The NInfer models are the
 * measured memory constants for the two Qwen artifacts NInfer serves, ported
 * from `docs/config-calculator.html` in the NInfer fork: every byte figure is
 * measured on an RTX 3090 (24 GiB, sm_86, CUDA 12.8) against the engine's own
 * capacity report, not estimated from parameter counts. The provenance note on
 * each model names the exact weight artifact the figures apply to, because the
 * runtime also recognizes other weight profiles with different resident sizes.
 * The Basalt models are the estimated sets for the engine's `.basalt`
 * artifacts: the measured figures are not yet available, so their terms are
 * estimated from the model size and flagged `source: 'estimated'`.
 * @module dsh-plugin-local-infer/providers/vram
 */
import type { VramModel } from 'dsh-plugin-local-infer/core';
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
/**
 * The Basalt estimated VramModels, one per `.basalt` artifact the engine
 * serves.
 *
 * The first is the Qwen3.8-Flash-Next NVFP4 artifact
 * (`Qwen3.8-FN-NVFP4-DQ6_K.basalt`). The measured figures are not yet
 * available, so every term is estimated from the model size, not measured
 * against the engine: the weights price a ~48B-total-parameter MoE in NVFP4
 * (0.5 bytes per parameter, ~24 GiB), and the KV per-token terms price a
 * 48-layer, 8-KV-head, 128-head-dim GQA layout across the four KV formats
 * Basalt serves (fp16, int8, q4_0, k8v4). The `source: 'estimated'` flag is
 * what keeps the meter from reading these as authoritative.
 *
 * Basalt's `spec` setting is a token-window count (a number), not a named
 * speculation backend, so neither model carries a `speculation` table or a
 * `specKey`: the estimator prices them from the base terms.
 */
export declare const BASALT_VRAM_MODELS: readonly VramModel[];
/**
 * Resolves a Basalt VramModel by its registry id, `qwen38-flash-next` or
 * `deepseek-v41-flash`.
 */
export declare function basaltVramModel(modelId: string): VramModel | undefined;
//# sourceMappingURL=vram.d.ts.map
