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
import { BASALT_DEEPSEEK_MODEL_ID, BASALT_DEFAULT_MODEL_ID, } from "./engines/basalt/basalt.js";
/**
 * DFlash2's CUDA-graph allowance is a step in context, measured at 8,192 /
 * 16,384 / 32,768: 288 MiB up to 8,192 tokens and 384 MiB beyond. Only three
 * contexts were measured, so a value between the steps takes the higher one.
 */
const dflash2GraphBytes = (ctx) => (ctx <= 8192 ? 301989888 : 402653184);
/**
 * Maps the engine's spec config values onto the 27B's measured speculation
 * entries. DFlash is a 35B companion-weight backend, so the 27B never
 * measured it and the mapping returns undefined, which the estimator reports
 * as not-measured rather than pricing it from another model.
 */
function specKeyFor27b(config) {
    const head = config.lmHeadDraft === true ? '+head' : '';
    if (config.spec === 'mtp')
        return 'mtp3' + head;
    if (config.spec === 'dflash2')
        return 'dflash2-7' + head;
    if (config.spec === 'dflash')
        return undefined;
    return 'none';
}
/**
 * Maps the engine's spec config values onto the 35B's measured speculation
 * entries. DFlash2 is the 27B companion-weight backend, so the 35B never
 * measured it and the mapping returns undefined.
 */
function specKeyFor35b(config) {
    const head = config.lmHeadDraft === true ? '+head' : '';
    if (config.spec === 'mtp')
        return 'mtp3' + head;
    if (config.spec === 'dflash')
        return 'dflash-3' + head;
    if (config.spec === 'dflash2')
        return undefined;
    return 'none';
}
/**
 * The NInfer measured VramModels, one per model artifact. The top-level
 * `seqFixedBytes`/`seqPerToken` are the no-speculation baseline; the
 * `speculation` table carries the per-mode terms the estimator prices, each
 * measured against the engine's own reported terms rather than borrowed from
 * the no-speculation figure.
 */
export const NINFER_VRAM_MODELS = [
    {
        id: 'qwen3-27b',
        source: 'measured',
        weightsBytes: 17093490688,
        workspaceBytes: 159981568,
        nativeMaxContext: 262144,
        seqFixedBytes: 166438656,
        seqPerToken: 0.0625,
        kvBytesPerToken: {
            bf16: 65536,
            int8: 33792,
            fp8: 33024,
            rk8v4: 26112,
            rk4v4: 17920,
            k8v4: 25728,
            nvfp4: 18432,
        },
        speculation: {
            none: {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: () => 12582912,
                seqFixedBytes: 166438656,
                seqPerToken: 0.0625,
                weightsGiB: 15.92,
            },
            mtp3: {
                kvRatio: 1.062988281,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 175693056,
                seqPerToken: 0.125,
                weightsGiB: 16.34,
            },
            'mtp3+head': {
                kvRatio: 1.062988281,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 175693056,
                seqPerToken: 0.125,
                weightsGiB: 16.67,
            },
            'dflash2-7': {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: dflash2GraphBytes,
                seqFixedBytes: 279090432,
                seqPerToken: 0.0625,
                weightsGiB: 17.99,
            },
            'dflash2-7+head': {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: dflash2GraphBytes,
                seqFixedBytes: 279090432,
                seqPerToken: 0.0625,
                weightsGiB: 18.33,
            },
        },
        specKey: specKeyFor27b,
    },
    // The Swift 1.5 ablated 27B the local launcher bootstraps. It is the same
    // 27B base model as `qwen3-27b`, so the meter prices it from the 27B measured
    // profile; the Swift 1.5 ablation changes the weights, not the per-token KV
    // terms, so the 27B profile is a sound floor for the meter.
    {
        id: 'qwen3-27b-swift15',
        source: 'measured',
        weightsBytes: 17093490688,
        workspaceBytes: 159981568,
        nativeMaxContext: 262144,
        seqFixedBytes: 166438656,
        seqPerToken: 0.0625,
        kvBytesPerToken: {
            bf16: 65536,
            int8: 33792,
            fp8: 33024,
            rk8v4: 26112,
            rk4v4: 17920,
            k8v4: 25728,
            nvfp4: 18432,
        },
        speculation: {
            none: {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: () => 12582912,
                seqFixedBytes: 166438656,
                seqPerToken: 0.0625,
                weightsGiB: 15.92,
            },
            mtp3: {
                kvRatio: 1.062988281,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 175693056,
                seqPerToken: 0.125,
                weightsGiB: 16.34,
            },
            'mtp3+head': {
                kvRatio: 1.062988281,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 175693056,
                seqPerToken: 0.125,
                weightsGiB: 16.67,
            },
            'dflash2-7': {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: dflash2GraphBytes,
                seqFixedBytes: 279090432,
                seqPerToken: 0.0625,
                weightsGiB: 17.99,
            },
            'dflash2-7+head': {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: dflash2GraphBytes,
                seqFixedBytes: 279090432,
                seqPerToken: 0.0625,
                weightsGiB: 18.33,
            },
        },
        specKey: specKeyFor27b,
    },
    {
        id: 'qwen3-35b',
        source: 'measured',
        weightsBytes: 21038469632,
        workspaceBytes: 109453312,
        nativeMaxContext: 262144,
        seqFixedBytes: 70579968,
        seqPerToken: 0.0625,
        kvBytesPerToken: {
            bf16: 20480,
            int8: 10560,
            fp8: 10320,
            rk8v4: 8160,
            rk4v4: 5600,
            k8v4: 8040,
            nvfp4: 5760,
        },
        speculation: {
            none: {
                kvRatio: 1,
                kvExtraPerToken: 0,
                graphBytes: () => 12582912,
                seqFixedBytes: 70579968,
                seqPerToken: 0.0625,
                weightsGiB: 19.59,
            },
            mtp3: {
                kvRatio: 1.10078125,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 76086528,
                seqPerToken: 0.125,
                weightsGiB: 20.43,
            },
            'mtp3+head': {
                kvRatio: 1.10078125,
                kvExtraPerToken: 0,
                graphBytes: () => 90177536,
                seqFixedBytes: 76086528,
                seqPerToken: 0.125,
                weightsGiB: 20.56,
            },
            'dflash-3': {
                kvRatio: 1,
                kvExtraPerToken: 4096,
                graphBytes: () => 167772160,
                seqFixedBytes: 193136896,
                seqPerToken: 0.125,
                weightsGiB: 19.98,
            },
            'dflash-3+head': {
                kvRatio: 1,
                kvExtraPerToken: 4096,
                graphBytes: () => 167772160,
                seqFixedBytes: 193136896,
                seqPerToken: 0.125,
                weightsGiB: 20.11,
            },
        },
        specKey: specKeyFor35b,
    },
];
/**
 * Resolves one NInfer VramModel by its registry id, e.g. `qwen3-27b`.
 */
export function ninferVramModel(modelId) {
    return NINFER_VRAM_MODELS.find(model => model.id === modelId);
}
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
export const BASALT_VRAM_MODELS = [
    {
        id: BASALT_DEFAULT_MODEL_ID,
        source: 'estimated',
        weightsBytes: 24000000000,
        workspaceBytes: 536870912,
        nativeMaxContext: 262144,
        seqFixedBytes: 10485760,
        seqPerToken: 0.0625,
        kvBytesPerToken: {
            fp16: 196608,
            int8: 98304,
            q4_0: 49152,
            k8v4: 73728,
        },
    },
    // The DeepSeek-V4.1-Flash UD-IQ1_M pack
    // (`DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt`). Every term is estimated
    // from the public pack facts, like the Qwen row. The weights: the native
    // checkpoint is ~510 GB of BF16 dense plus MXFP4 expert weights, a
    // ~6.8 bits-per-weight average, which prices ~600B weights; the pack
    // requantizes them to UD-IQ1_M's ~1.7 bits per weight, ~1.3e11 bytes
    // (~121 GiB) resident. The checkpoint's other ~393 GB of engram lookup
    // tables stream from RAM and file, so they add no resident weights and no
    // term prices them. The KV: the pack has no KV-format choice, so the
    // engine's single format is priced under the `fp16` key the kv surface
    // defaults to; a DeepSeek latent-KV (MLA-family) layout carries ~576
    // fp16 elements per layer (~1152 bytes), and ~46080 bytes per token is
    // that order at ~40 attention layers, the compact pool that makes the
    // pack's 1,048,576-token cap a ~48 GB KV pool at all. The workspace,
    // fixed-session, and per-token activation terms ride at the Blackwell
    // order for a model this size, a few times the Qwen estimates.
    {
        id: BASALT_DEEPSEEK_MODEL_ID,
        source: 'estimated',
        weightsBytes: 130000000000,
        workspaceBytes: 1073741824,
        nativeMaxContext: 1048576,
        seqFixedBytes: 33554432,
        seqPerToken: 0.125,
        kvBytesPerToken: {
            fp16: 46080,
        },
    },
];
/**
 * Resolves a Basalt VramModel by its registry id, `qwen38-flash-next` or
 * `deepseek-v41-flash`.
 */
export function basaltVramModel(modelId) {
    return BASALT_VRAM_MODELS.find(model => model.id === modelId);
}
//# sourceMappingURL=vram.js.map
