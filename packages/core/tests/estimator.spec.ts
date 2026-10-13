import { describe, expect, it } from 'vitest'
import { estimateVram, KV_PAGE_TOKENS, pageRoundUp } from '../src/index.ts'
import type {
  Config,
  HardwareProfile,
  ParameterSpec,
  VramModel,
} from '../src/index.ts'

const HW_3090: HardwareProfile = {
  gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 16,
}
const HW_NO_GPU: HardwareProfile = { dockerAvailable: false, wsl2: false, os: 'linux', cpuThreads: 8 }

/**
 * The 27B measured constants, the same figures the provider data carries. The
 * core suite keeps its own copy so the estimator is tested without the
 * provider package; the provider suite asserts its data matches these.
 */
function model27b(): VramModel {
  return {
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
        graphBytes: (ctx: number) => (ctx <= 8192 ? 301989888 : 402653184),
        seqFixedBytes: 279090432,
        seqPerToken: 0.0625,
        weightsGiB: 17.99,
      },
    },
  }
}

/** The 35B measured constants, DFlash-3 included. */
function model35b(): VramModel {
  return {
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
      'dflash-3': {
        kvRatio: 1,
        kvExtraPerToken: 4096,
        graphBytes: () => 167772160,
        seqFixedBytes: 193136896,
        seqPerToken: 0.125,
        weightsGiB: 19.98,
      },
    },
  }
}

const reservation = (estimate: ReturnType<typeof estimateVram>): number =>
  estimate.breakdown.kv + estimate.breakdown.overhead + estimate.breakdown.workspace

describe('pageRoundUp', () => {
  it('keeps an exact multiple, rounds a token over up a full page', () => {
    expect(pageRoundUp(8192)).toBe(8192)
    expect(pageRoundUp(8193)).toBe(8192 + KV_PAGE_TOKENS)
  })

  it('rounds a token under the boundary up to it and floors below one page', () => {
    expect(pageRoundUp(8191)).toBe(8192)
    expect(pageRoundUp(1)).toBe(KV_PAGE_TOKENS)
    expect(pageRoundUp(0)).toBe(0)
  })
})

describe('estimateVram golden cases (the NInfer engine refusal figures)', () => {
  it('262144-token int8, no speculation, 27B: the engine refuses with exactly 9197389568 bytes', () => {
    const estimate = estimateVram(model27b(), { kvDtype: 'int8', maxContext: 262144 }, HW_3090)
    // The engine's refusal is the incremental reservation on top of the
    // already-resident weights: KV + sequence state + workspace + graph.
    expect(reservation(estimate)).toBe(9197389568)
  })

  it('262144-token int8 with MTP3 + draft head, 27B: within 0.1% of the engine figure', () => {
    const estimate = estimateVram(
      model27b(),
      { kvDtype: 'int8', maxContext: 262144, spec: 'mtp3+head' },
      HW_3090,
    )
    const engine = 9838038272
    const error = Math.abs(reservation(estimate) - engine) / engine
    expect(error).toBeLessThan(0.001)
  })

  it('262144-token int8 with DFlash-3, 35B: matches the engine figure to the byte', () => {
    const estimate = estimateVram(
      model35b(),
      { kvDtype: 'int8', maxContext: 262144, spec: 'dflash-3' },
      HW_3090,
    )
    expect(reservation(estimate)).toBe(4312377600)
  })

  it('prices DFlash extra KV as a fixed 4096 bytes per token, not a ratio', () => {
    const model = model35b()
    const plain = estimateVram(model, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    const dflash = estimateVram(
      model,
      { kvDtype: 'int8', maxContext: 4096, spec: 'dflash-3' },
      HW_3090,
    )
    // 4096 of extra cache per token at 4096 tokens, plus the doubled
    // non-KV per-token term (0.0625 to 0.125) over the same span.
    expect(dflash.breakdown.kv - plain.breakdown.kv).toBe(4096 * 4096)
    expect(model.speculation?.['dflash-3']?.seqFixedBytes).toBe(193136896)
    expect(dflash.breakdown.overhead - plain.breakdown.overhead).toBe(
      (193136896 - model.seqFixedBytes) + (0.125 - 0.0625) * 4096,
    )
  })

  it('steps the DFlash2 graph allowance with context (288 MiB to 384 MiB past 8192)', () => {
    const model = model27b()
    const shallow = estimateVram(model, { kvDtype: 'int8', maxContext: 8192, spec: 'dflash2-7' }, HW_3090)
    const deep = estimateVram(model, { kvDtype: 'int8', maxContext: 16384, spec: 'dflash2-7' }, HW_3090)
    expect(deep.breakdown.workspace - shallow.breakdown.workspace).toBe(96 * 1024 * 1024)
  })
})

describe('estimateVram verdicts', () => {
  it('reports not-measured when no VramModel is registered', () => {
    const estimate = estimateVram(undefined, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    expect(estimate.verdict.status).toBe('not-measured')
    expect(estimate.source).toBe('not-measured')
    expect(estimate.breakdown.largestFittingContext).toBeNull()
  })

  it('reports not-measured for an unmeasured KV format and speculation mode', () => {
    const model = model27b()
    expect(estimateVram(model, { kvDtype: 'nope', maxContext: 4096 }, HW_3090).verdict.status)
      .toBe('not-measured')
    expect(estimateVram(model, { kvDtype: 'int8', maxContext: 4096, spec: 'dflash-3' }, HW_3090)
      .verdict.status).toBe('not-measured')
  })

  it('reports over when the total exceeds the usable budget', () => {
    const estimate = estimateVram(model27b(), { kvDtype: 'bf16', maxContext: 262144 }, HW_3090)
    expect(estimate.verdict.status).toBe('over')
    expect(estimate.verdict.detail).toContain('Over budget')
  })

  it('reports tight when the headroom falls under half a GiB', () => {
    // 27B bf16 at 127,000 tokens on a 24 GiB card: the page-rounded KV cache
    // leaves about 11 MiB of headroom, well under the 0.5 GiB tight line.
    const estimate = estimateVram(model27b(), { kvDtype: 'bf16', maxContext: 127000 }, HW_3090)
    expect(estimate.verdict.status).toBe('tight')
    expect(estimate.verdict.detail).toContain('to spare')
  })

  it('reports fits with the headroom readout when the budget holds', () => {
    const estimate = estimateVram(model35b(), { kvDtype: 'int8', maxContext: 32768 }, HW_3090)
    expect(estimate.verdict.status).toBe('fits')
    expect(estimate.verdict.detail).toContain('leaving')
  })

  it('reports over on a host with no GPU, where the usable budget is zero', () => {
    const estimate = estimateVram(model27b(), { kvDtype: 'int8', maxContext: 4096 }, HW_NO_GPU)
    expect(estimate.verdict.status).toBe('over')
  })
})

describe('estimateVram largest-fitting-context', () => {
  it('always lands on a 64-token page boundary and never exceeds the budget', () => {
    const model = model27b()
    for (const reserveMiB of [0, 307, 1536, 2560]) {
      const estimate = estimateVram(
        model,
        { kvDtype: 'int8', maxContext: 32768, reserveMiB },
        HW_3090,
      )
      const maxCtx = estimate.breakdown.largestFittingContext
      expect(maxCtx).not.toBeNull()
      expect(maxCtx % KV_PAGE_TOKENS).toBe(0)
      // Reconstruct the total at the solved context the same way the
      // estimator prices it: the solved context must fit the budget.
      const atMax = estimateVram(model, { kvDtype: 'int8', maxContext: maxCtx!, reserveMiB }, HW_3090)
      expect(atMax.breakdown.total).toBeLessThanOrEqual(estimate.breakdown.usable + 1e-6)
    }
  })

  it('caps at the model native limit when the budget would buy more', () => {
    const estimate = estimateVram(model35b(), { kvDtype: 'int8', maxContext: 32768 }, HW_3090)
    expect(estimate.breakdown.largestFittingContext).toBe(262144)
  })

  it('responds to the speculation mode (DFlash-3 tops out below no speculation)', () => {
    const config: Config = { kvDtype: 'int8', maxContext: 32768, reserveMiB: 307 }
    const none = estimateVram(model35b(), config, HW_3090)
    const dflash = estimateVram(model35b(), { ...config, spec: 'dflash-3' }, HW_3090)
    expect(none.breakdown.largestFittingContext).toBe(262144)
    expect(dflash.breakdown.largestFittingContext).toBe(240192)
  })

  it('reports null when the KV format has no measured bytes', () => {
    const model: VramModel = { ...model27b(), kvBytesPerToken: {} }
    const estimate = estimateVram(model, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    expect(estimate.verdict.status).toBe('not-measured')
    expect(estimate.breakdown.largestFittingContext).toBeNull()
  })
})

describe('estimateVram config plumbing', () => {
  it('reads the OS reserve from reserveGiB and reserveMiB', () => {
    const model = model35b()
    const viaGiB = estimateVram(model, { kvDtype: 'int8', maxContext: 4096, reserveGiB: 1.5 }, HW_3090)
    const viaMiB = estimateVram(model, { kvDtype: 'int8', maxContext: 4096, reserveMiB: 1536 }, HW_3090)
    expect(viaGiB.breakdown.usable).toBe(viaMiB.breakdown.usable)
    expect(viaGiB.breakdown.reserve).toBe(1536 * 1024 * 1024)
  })

  it('prices the no-speculation baseline when the config names no spec', () => {
    const model = model27b()
    const explicit = estimateVram(model, { kvDtype: 'int8', maxContext: 4096, spec: 'none' }, HW_3090)
    const absent = estimateVram(model, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    expect(absent.breakdown).toEqual(explicit.breakdown)
  })

  it('sums parameter contributions into the buckets', () => {
    const model = model35b()
    const vision: ParameterSpec = {
      key: 'vision',
      label: 'Vision input',
      description: 'Accepts image and video input. Adds the vision tower to resident memory.',
      form: { kind: 'boolean' },
      defaultValue: false,
      vramContribution: (_value, ctx) => ({ workspace: ctx.ctx * 128 }),
    }
    const plain = estimateVram(model, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    const withVision = estimateVram(
      model,
      { kvDtype: 'int8', maxContext: 4096, vision: true },
      HW_3090,
      [vision],
    )
    expect(withVision.breakdown.workspace - plain.breakdown.workspace).toBe(4096 * 128)
  })

  it('treats a missing maxContext as a zero-length context', () => {
    // The fixed cost (weights + sequence state + workspace) still prices, so
    // the verdict is a real answer about the resident footprint, not a skip.
    const model = model27b()
    const estimate = estimateVram(model, { kvDtype: 'int8' }, HW_3090)
    expect(estimate.breakdown.kv).toBe(0)
    expect(estimate.verdict.status).toBe('fits')
    expect(estimate.breakdown.total).toBe(
      model.weightsBytes + model.seqFixedBytes + model.workspaceBytes + 12582912,
    )
  })
})
