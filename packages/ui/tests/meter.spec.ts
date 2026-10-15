import { describe, expect, it } from 'vitest'
import type { VramBreakdown, VramVerdict } from '@dsh/dsh-plugin-local-infer/core'
import { renderMeter } from '../src/meter.ts'

const GiB = 1024 * 1024 * 1024

function breakdown(overrides: Partial<VramBreakdown> = {}): VramBreakdown {
  // The buckets sum to the card: 20.5 used + 3.0 free + 0.5 reserve = 24.0.
  return {
    weights: 16 * GiB,
    kv: 4 * GiB,
    overhead: 0.2 * GiB,
    workspace: 0.3 * GiB,
    free: 3 * GiB,
    reserve: 0.5 * GiB,
    total: 20.5 * GiB,
    usable: 24 * GiB,
    largestFittingContext: 262144,
    ...overrides,
  }
}

const fits: VramVerdict = { status: 'fits', detail: '20.50 GiB of 24.00 GiB, leaving 3.50 GiB.' }
const notMeasured: VramVerdict = { status: 'not-measured', detail: 'no VramModel registered' }

describe('renderMeter', () => {
  it('draws the six segments in bar order, to scale against the full card', () => {
    const model = renderMeter(breakdown(), fits, 24, 'measured')
    expect(model.segments.map(segment => segment.key)).toEqual([
      'weights',
      'kv',
      'overhead',
      'workspace',
      'free',
      'reserve',
    ])
    expect(model.cardBytes).toBe(24 * GiB)
    const total = model.segments.reduce((sum, segment) => sum + segment.percent, 0)
    expect(total).toBeCloseTo(100, 1)
    expect(model.segments[0]?.percent).toBeCloseTo((16 / 24) * 100, 1)
  })

  it('passes the verdict and the largest-fitting-context readout through', () => {
    const model = renderMeter(breakdown(), fits, 24, 'measured')
    expect(model.verdict).toBe(fits)
    expect(model.largestFittingContext).toBe(262144)
    expect(model.source).toBe('measured')
  })

  it('keeps a null largest-fitting-context readable as no context fits', () => {
    const model = renderMeter(breakdown({ largestFittingContext: null }), notMeasured, 24, 'measured')
    expect(model.largestFittingContext).toBeNull()
  })

  it('labels a not-measured verdict not-measured, hiding the source badge', () => {
    const model = renderMeter(breakdown(), notMeasured, 24, 'measured')
    expect(model.source).toBe('not-measured')
  })

  it('shows the estimated badge on an estimated-source fit', () => {
    const model = renderMeter(breakdown(), fits, 24, 'estimated')
    expect(model.source).toBe('estimated')
  })

  it('degrades to zero percents on a host with no GPU', () => {
    const model = renderMeter(breakdown(), fits, 0, 'measured')
    expect(model.cardBytes).toBe(0)
    for (const segment of model.segments) {
      expect(segment.percent).toBe(0)
    }
  })

  it('rides the reserve source through so the readout names where the dark segment came from', () => {
    const foreign = renderMeter(breakdown(), fits, 24, 'measured', 'foreign-process')
    expect(foreign.reserveSource).toBe('foreign-process')
    const busy = renderMeter(breakdown(), fits, 24, 'measured', 'gpu-usage')
    expect(busy.reserveSource).toBe('gpu-usage')
    const explicit = renderMeter(breakdown(), fits, 24, 'measured', 'explicit')
    expect(explicit.reserveSource).toBe('explicit')
    // An absent source reads as the 3 GiB default, the pre-Phase-10 behavior.
    const defaulted = renderMeter(breakdown(), fits, 24, 'measured')
    expect(defaulted.reserveSource).toBe('default')
  })

  it('carries the Unknown Engine(s) readout when unsure programs hold VRAM', () => {
    // A foreign engine holding 4 GiB: the readout names that footprint so the
    // user sees the VRAM a provider launched in another session is eating.
    const model = renderMeter(
      breakdown(),
      fits,
      24,
      'measured',
      'foreign-process',
      { bytes: 4 * GiB },
    )
    expect(model.unknownEngines).toEqual({ bytes: 4 * GiB })
  })

  it('omits the Unknown Engine(s) readout when no provider reads as unsure', () => {
    // Absent (the default) and explicit null both read as no foreign engine,
    // so the section stays out of the meter.
    const absent = renderMeter(breakdown(), fits, 24, 'measured')
    expect(absent.unknownEngines).toBeNull()
    const explicitNull = renderMeter(breakdown(), fits, 24, 'measured', 'default', null)
    expect(explicitNull.unknownEngines).toBeNull()
  })
})
