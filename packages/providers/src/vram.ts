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

import type { Config, VramModel } from '@dsh/dsh-plugin-local-infer/core'

/**
 * DFlash2's CUDA-graph allowance is a step in context, measured at 8,192 /
 * 16,384 / 32,768: 288 MiB up to 8,192 tokens and 384 MiB beyond. Only three
 * contexts were measured, so a value between the steps takes the higher one.
 */
const dflash2GraphBytes = (ctx: number): number => (ctx <= 8192 ? 301989888 : 402653184)

/**
 * Maps the engine's spec config values onto the 27B's measured speculation
 * entries. DFlash is a 35B companion-weight backend, so the 27B never
 * measured it and the mapping returns undefined, which the estimator reports
 * as not-measured rather than pricing it from another model.
 */
function specKeyFor27b(config: Config): string | undefined {
  const head = config.lmHeadDraft === true ? '+head' : ''
  if (config.spec === 'mtp') return 'mtp3' + head
  if (config.spec === 'dflash2') return 'dflash2-7' + head
  if (config.spec === 'dflash') return undefined
  return 'none'
}

/**
 * Maps the engine's spec config values onto the 35B's measured speculation
 * entries. DFlash2 is the 27B companion-weight backend, so the 35B never
 * measured it and the mapping returns undefined.
 */
function specKeyFor35b(config: Config): string | undefined {
  const head = config.lmHeadDraft === true ? '+head' : ''
  if (config.spec === 'mtp') return 'mtp3' + head
  if (config.spec === 'dflash') return 'dflash-3' + head
  if (config.spec === 'dflash2') return undefined
  return 'none'
}

/**
 * The NInfer measured VramModels, one per model artifact. The top-level
 * `seqFixedBytes`/`seqPerToken` are the no-speculation baseline; the
 * `speculation` table carries the per-mode terms the estimator prices, each
 * measured against the engine's own reported terms rather than borrowed from
 * the no-speculation figure.
 */
export const NINFER_VRAM_MODELS: readonly VramModel[] = [
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
]

/**
 * Resolves one NInfer VramModel by its registry id, e.g. `qwen3-27b`.
 */
export function ninferVramModel(modelId: string): VramModel | undefined {
  return NINFER_VRAM_MODELS.find(model => model.id === modelId)
}
