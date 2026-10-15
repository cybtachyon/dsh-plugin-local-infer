import { describe, expect, it } from 'vitest'
import { estimateVram } from 'dsh-plugin-local-infer/core'
import type { HardwareProfile } from 'dsh-plugin-local-infer/core'
import { NINFER_VRAM_MODELS, ninferVramModel } from '../src/vram.ts'

const HW_3090: HardwareProfile = {
  gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 16,
}

const reservation = (estimate: ReturnType<typeof estimateVram>): number =>
  estimate.breakdown.kv + estimate.breakdown.overhead + estimate.breakdown.workspace

describe('NInfer VramModel data', () => {
  it('carries one measured model per Qwen artifact, keyed by the registry id', () => {
    expect(NINFER_VRAM_MODELS.map(model => model.id)).toEqual([
      'qwen3-27b',
      'qwen3-27b-swift15',
      'qwen3-35b',
    ])
    for (const model of NINFER_VRAM_MODELS) {
      expect(model.source).toBe('measured')
      expect(model.nativeMaxContext).toBe(262144)
    }
    expect(ninferVramModel('qwen3-27b')?.id).toBe('qwen3-27b')
    expect(ninferVramModel('qwen3-27b-swift15')?.id).toBe('qwen3-27b-swift15')
    expect(ninferVramModel('qwen3-99b')).toBeUndefined()
  })

  it('ports the calculator constants byte for byte', () => {
    const model27b = ninferVramModel('qwen3-27b')!
    expect(model27b.weightsBytes).toBe(17093490688)
    expect(model27b.workspaceBytes).toBe(159981568)
    expect(model27b.kvBytesPerToken).toEqual({
      bf16: 65536,
      int8: 33792,
      fp8: 33024,
      rk8v4: 26112,
      rk4v4: 17920,
      k8v4: 25728,
      nvfp4: 18432,
    })
    expect(model27b.speculation?.['dflash2-7']?.graphBytes?.(8192)).toBe(301989888)
    expect(model27b.speculation?.['dflash2-7']?.graphBytes?.(16384)).toBe(402653184)

    const model35b = ninferVramModel('qwen3-35b')!
    expect(model35b.weightsBytes).toBe(21038469632)
    expect(model35b.workspaceBytes).toBe(109453312)
    expect(model35b.kvBytesPerToken.int8).toBe(10560)
    expect(model35b.speculation?.['dflash-3']?.kvExtraPerToken).toBe(4096)
    expect(model35b.speculation?.['dflash-3']?.kvRatio).toBe(1)
  })

  it('maps the engine spec values onto each model measured entries', () => {
    const model27b = ninferVramModel('qwen3-27b')!
    expect(model27b.specKey!({ spec: 'mtp' })).toBe('mtp3')
    expect(model27b.specKey!({ spec: 'mtp', lmHeadDraft: true })).toBe('mtp3+head')
    expect(model27b.specKey!({ spec: 'dflash2', lmHeadDraft: true })).toBe('dflash2-7+head')
    // DFlash is a 35B backend, so the 27B never measured it.
    expect(model27b.specKey!({ spec: 'dflash' })).toBeUndefined()
    expect(model27b.specKey!({})).toBe('none')

    const model35b = ninferVramModel('qwen3-35b')!
    expect(model35b.specKey!({ spec: 'dflash' })).toBe('dflash-3')
    expect(model35b.specKey!({ spec: 'dflash', lmHeadDraft: true })).toBe('dflash-3+head')
    expect(model35b.specKey!({ spec: 'dflash2' })).toBeUndefined()
  })

  it('reports not-measured for a spec mode the model never measured', () => {
    const model27b = ninferVramModel('qwen3-27b')!
    const estimate = estimateVram(
      model27b,
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'dflash' },
      HW_3090,
    )
    expect(estimate.verdict.status).toBe('not-measured')
  })

  it('reproduces the engine refusal figures through the estimator', () => {
    const model27b = ninferVramModel('qwen3-27b')!
    const model35b = ninferVramModel('qwen3-35b')!

    // No speculation on the 27B: the engine refuses 262144 int8 with exactly
    // 9197389568 bytes of incremental reservation.
    const plain = estimateVram(model27b, { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144 }, HW_3090)
    expect(reservation(plain)).toBe(9197389568)

    // MTP3 with the draft head on the 27B: the engine figure 9838038272,
    // reproduced to within 0.1% (the page-rounding difference).
    const mtp = estimateVram(
      model27b,
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144, spec: 'mtp', lmHeadDraft: true },
      HW_3090,
    )
    const mtpError = Math.abs(reservation(mtp) - 9838038272) / 9838038272
    expect(mtpError).toBeLessThan(0.001)

    // DFlash-3 on the 35B: the engine figure 4312377600, to the byte.
    const dflash = estimateVram(
      model35b,
      { model: 'qwen3-35b', kvDtype: 'int8', maxContext: 262144, spec: 'dflash' },
      HW_3090,
    )
    expect(reservation(dflash)).toBe(4312377600)
  })

  it('labels every estimate measured, so the meter never reads it as a guess', () => {
    const model27b = ninferVramModel('qwen3-27b')!
    const estimate = estimateVram(model27b, { kvDtype: 'int8', maxContext: 4096 }, HW_3090)
    expect(estimate.source).toBe('measured')
  })

  it('prices every model x spec x KV x context combination without throwing', () => {
    // The grid guard the NInfer render test runs against the calculator page:
    // nothing may throw across the full combination space, and a not-measured
    // spec mode (a backend the model never measured) must read not-measured,
    // never a silent price.
    const kvs = ['bf16', 'int8', 'fp8', 'rk8v4', 'rk4v4', 'k8v4', 'nvfp4']
    const specs = ['none', 'mtp', 'dflash', 'dflash2']
    const ctxs = [256, 4096, 8192, 8193, 40960, 262144]
    let runs = 0
    for (const model of NINFER_VRAM_MODELS) {
      for (const spec of specs) {
        for (const kv of kvs) {
          for (const ctx of ctxs) {
            const estimate = estimateVram(
              model,
              { model: model.id, kvDtype: kv, maxContext: ctx, spec },
              HW_3090,
            )
            if (estimate.verdict.status === 'not-measured') {
              // Only the unmeasured backend pair may read not-measured.
              const measured = model.specKey!({ spec }) !== undefined
              expect(measured, `${model.id}/${spec} should be measured`).toBe(false)
            } else {
              runs++
              expect(estimate.breakdown.total).toBeGreaterThan(0)
              expect(estimate.breakdown.usable).toBeGreaterThan(0)
            }
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(0)
  })

  it('prices the draft-head (+head) variants the grid leaves out', () => {
    // The grid above never sets lmHeadDraft, so the +head measured entries
    // (the 27B mtp3+head / dflash2-7+head and the 35B mtp3+head / dflash-3+head)
    // are only reached when the head flag is on. Price them so the data is
    // exercised, and confirm a head draft prices at least as much as the plain
    // mode, so the meter never underprices a draft-head run.
    for (const model of NINFER_VRAM_MODELS) {
      for (const spec of ['mtp', 'dflash', 'dflash2']) {
        const plain = estimateVram(
          model,
          { model: model.id, kvDtype: 'int8', maxContext: 32768, spec },
          HW_3090,
        )
        if (plain.verdict.status === 'not-measured') continue
        const withHead = estimateVram(
          model,
          { model: model.id, kvDtype: 'int8', maxContext: 32768, spec, lmHeadDraft: true },
          HW_3090,
        )
        if (withHead.verdict.status === 'not-measured') continue
        expect(withHead.breakdown.total).toBeGreaterThanOrEqual(plain.breakdown.total)
      }
    }
  })

  it('keeps the largest-fitting-context responsive to the spec mode across the grid', () => {
    // The failure mode the per-mode terms fix: before them every spec mode
    // reported the no-speculation context, silently promising context a
    // speculative configuration cannot deliver.
    for (const model of NINFER_VRAM_MODELS) {
      const base = estimateVram(
        model,
        { model: model.id, kvDtype: 'int8', maxContext: 32768, reserveMiB: 307 },
        HW_3090,
      )
      for (const spec of ['mtp', 'dflash', 'dflash2']) {
        const withSpec = estimateVram(
          model,
          { model: model.id, kvDtype: 'int8', maxContext: 32768, reserveMiB: 307, spec },
          HW_3090,
        )
        if (withSpec.verdict.status === 'not-measured') continue
        // A speculative mode prices at least as much as none, so it can never
        // fit a longer context.
        expect(withSpec.breakdown.largestFittingContext).toBeLessThanOrEqual(
          base.breakdown.largestFittingContext,
        )
      }
    }
  })
})
