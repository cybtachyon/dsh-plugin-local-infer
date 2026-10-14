import { describe, expect, it } from 'vitest'
import {
  constraintId,
  estimateVram,
  evaluateGuidelines,
  modelGuidelines,
} from '../src/index.ts'
import type {
  Guideline,
  GuidelineLevel,
  GuidelineResult,
  HardwareProfile,
  ParameterSpec,
  VramModel,
} from '../src/index.ts'

const HW: HardwareProfile = {
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 4,
  gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
  hostRamGiB: 32,
}

function guideline(
  id: string,
  fires: boolean,
  level: GuidelineLevel = 'error',
  anchors?: string[],
): Guideline {
  return {
    id,
    level,
    message: `message for ${id}`,
    when: () => fires,
    ...(anchors !== undefined ? { anchors } : {}),
  }
}

/** A spec whose constraint rejects the value "bad" with the given severity. */
function constrainedSpec(key: string, severity: 'warn' | 'error', defaultValue?: unknown): ParameterSpec {
  return {
    key,
    label: key,
    description: `Rejects the value "bad" on this hardware.`,
    form: { kind: 'enum', options: [{ value: 'bad', label: 'bad' }, { value: 'ok', label: 'ok' }] },
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    hardwareConstraint: (value) =>
      value === 'bad'
        ? { ok: false, severity, message: `${key} rejects "bad" on this hardware` }
        : { ok: true },
  }
}

/** A measured 27B-shaped model, the same constants the provider data pins. */
function model27b(overrides: Partial<VramModel> = {}): VramModel {
  return {
    id: 'qwen3-27b',
    source: 'measured',
    weightsBytes: 17093490688,
    workspaceBytes: 159981568,
    nativeMaxContext: 262144,
    seqFixedBytes: 166438656,
    seqPerToken: 0.0625,
    kvBytesPerToken: { int8: 33792 },
    speculation: {
      none: {
        kvRatio: 1,
        kvExtraPerToken: 0,
        seqFixedBytes: 166438656,
        seqPerToken: 0.0625,
        weightsGiB: 15.92,
      },
      mtp3: {
        kvRatio: 1.062988281,
        kvExtraPerToken: 0,
        seqFixedBytes: 175693056,
        seqPerToken: 0.125,
        weightsGiB: 16.34,
      },
      'dflash2-7': {
        kvRatio: 1,
        kvExtraPerToken: 0,
        seqFixedBytes: 279090432,
        seqPerToken: 0.0625,
        weightsGiB: 17.99,
      },
    },
    ...overrides,
  }
}

describe('evaluateGuidelines', () => {
  it('fires a guideline with its id, level, message, and anchors, and skips the rest', () => {
    const results = evaluateGuidelines(
      [guideline('a', true, 'error', ['maxContext']), guideline('b', false), guideline('c', true, 'warn')],
      [],
      {},
      HW,
    )
    expect(results).toEqual([
      { id: 'a', level: 'error', message: 'message for a', anchors: ['maxContext'] },
      { id: 'c', level: 'warn', message: 'message for c' },
    ])
  })

  it('runs spec constraints in spec order with a namespaced id and an anchor', () => {
    const specs = [constrainedSpec('kvDtype', 'error'), constrainedSpec('spec', 'warn')]
    const results = evaluateGuidelines([], specs, { kvDtype: 'bad', spec: 'bad' }, HW)
    expect(results).toEqual([
      {
        id: constraintId('kvDtype'),
        level: 'error',
        message: 'kvDtype rejects "bad" on this hardware',
        anchors: ['kvDtype'],
      },
      {
        id: constraintId('spec'),
        level: 'warn',
        message: 'spec rejects "bad" on this hardware',
        anchors: ['spec'],
      },
    ])
  })

  it('puts named guidelines before spec constraints in the result list', () => {
    const results = evaluateGuidelines(
      [guideline('rule', true, 'error')],
      [constrainedSpec('kvDtype', 'error')],
      { kvDtype: 'bad' },
      HW,
    )
    expect(results.map((result) => result.id)).toEqual(['rule', constraintId('kvDtype')])
  })

  it('prices a constraint on the config value, falling back to the spec default', () => {
    const specs = [constrainedSpec('kvDtype', 'error', 'bad'), constrainedSpec('spec', 'error', 'ok')]
    // kvDtype: no config value, default "bad" fires. spec: default "ok" stays silent.
    const results = evaluateGuidelines([], specs, {}, HW)
    expect(results.map((result) => result.id)).toEqual([constraintId('kvDtype')])
    // An explicit config value wins over the default.
    const explicit = evaluateGuidelines([], specs, { kvDtype: 'ok', spec: 'bad' }, HW)
    expect(explicit.map((result) => result.id)).toEqual([constraintId('spec')])
  })

  it('skips a spec with no value and no default, and a spec without a constraint', () => {
    const bare: ParameterSpec = {
      key: 'temperature',
      label: 'Temperature',
      description: 'Samples the token distribution.',
      form: { kind: 'number' },
    }
    expect(evaluateGuidelines([], [bare], {}, HW)).toEqual([])
    expect(evaluateGuidelines([], [constrainedSpec('kvDtype', 'error')], {}, HW)).toEqual([])
  })

  it('returns an empty list when nothing fires', () => {
    expect(evaluateGuidelines([guideline('a', false)], [], {}, HW)).toEqual([])
  })
})

describe('modelGuidelines', () => {
  it('fires vram-exceeds-usable when the estimate is over, agreeing with the estimator', () => {
    const model = model27b()
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144 }
    const estimate = estimateVram(model, config, HW)
    expect(estimate.verdict.status).toBe('over')

    const results = modelGuidelines(model, config, HW)
    expect(results).toHaveLength(1)
    const over = results[0] as GuidelineResult
    expect(over.id).toBe('vram-exceeds-usable')
    expect(over.level).toBe('error')
    expect(over.anchors).toEqual(['maxContext'])
    // The readout names the estimator's own largest-fitting-context, so the
    // rule and the Phase 2 meter cannot disagree.
    expect(over.message).toContain(`the largest fitting context is ${estimate.breakdown.largestFittingContext}`)
  })

  it('reads "no context fits this card" when the solver finds no fitting context', () => {
    const model = model27b({ weightsBytes: 30 * 1024 ** 3 })
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096 }
    const estimate = estimateVram(model, config, HW)
    expect(estimate.verdict.status).toBe('over')
    expect(estimate.breakdown.largestFittingContext).toBe(0)

    const results = modelGuidelines(model, config, HW)
    expect(results[0]?.id).toBe('vram-exceeds-usable')
    expect(results[0]?.message).toContain('no context fits this card')
  })

  it('stays silent on a fit with a measured spec', () => {
    const model = model27b({
      specKey: (config) => (config.spec === 'mtp' ? 'mtp3' : 'none'),
    })
    const results = modelGuidelines(model, { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'mtp' }, HW)
    expect(results).toEqual([])
  })

  it('fires spec-needs-draft-weights for a spec the model never measured', () => {
    // The 27B measured mtp and dflash2, never dflash: the mapping reads
    // undefined, which the estimator reports not-measured and the rule fires.
    const model = model27b({
      specKey: (config) =>
        config.spec === 'mtp' ? 'mtp3' : config.spec === 'dflash2' ? 'dflash2-7' : undefined,
    })
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'dflash' }
    const results = modelGuidelines(model, config, HW)
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('spec-needs-draft-weights')
    expect(results[0]?.level).toBe('error')
    expect(results[0]?.anchors).toEqual(['spec'])
    expect(results[0]?.message).toBe(
      'The dflash spec needs the draft companion weights the qwen3-27b artifact does not carry. Pick dflash2, mtp.',
    )
  })

  it('stays silent with no spec or the none spec', () => {
    const model = model27b()
    expect(modelGuidelines(model, { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096 }, HW)).toEqual([])
    expect(modelGuidelines(model, { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'none' }, HW)).toEqual([])
  })

  it('fires for a spec a model without a speculation table never measured', () => {
    const model: VramModel = {
      id: 'qwen3-27b',
      source: 'measured',
      weightsBytes: 17093490688,
      workspaceBytes: 159981568,
      nativeMaxContext: 262144,
      seqFixedBytes: 166438656,
      seqPerToken: 0.0625,
      kvBytesPerToken: { int8: 33792 },
    }
    const results = modelGuidelines(model, { model: 'qwen3-27b', kvDtype: 'int8', spec: 'mtp' }, HW)
    expect(results.map((result) => result.id)).toEqual(['spec-needs-draft-weights'])
  })
})
