import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EngineAdapter, estimateVram } from '@dsh/dsh-plugin-local-infer/core'
import type {
  Config,
  DeployResult,
  Guideline,
  HardwareProfile,
  HealthResult,
  LaunchPlan,
  ParameterSpec,
  Preset,
  VramModel,
} from '@dsh/dsh-plugin-local-infer/core'
import LocalInfer, { LocalInferError, runHardwareProbes } from '../src/index.ts'

const HW: HardwareProfile = { dockerAvailable: false, wsl2: false, os: 'linux', cpuThreads: 4 }

/** A minimal concrete adapter for exercising the engine registry. */
class StubAdapter extends EngineAdapter {
  constructor(readonly id: string) {
    super()
  }
  readonly supports = { docker: true, local: true }

  parameters(): ParameterSpec[] {
    return []
  }

  renderLaunch(_config: Config, _hw: HardwareProfile): LaunchPlan {
    return { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
  }

  async healthCheck(_plan: LaunchPlan): Promise<HealthResult> {
    return { healthy: true }
  }

  async deploy(_plan: LaunchPlan): Promise<DeployResult> {
    return { ok: true }
  }

  async stop(_plan: LaunchPlan): Promise<void> {
    /* nothing to stop */
  }
}

function preset(engineId: string, modelId: string, hardwareClass: string): Preset {
  return { engineId, modelId, hardwareClass, values: {}, source: 'builtin' }
}

function guideline(id: string): Guideline {
  return {
    id,
    level: 'warn',
    message: 'a warning',
    when: () => true,
  }
}

function vramModel(id: string): VramModel {
  return {
    id,
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
        graphBytes: () => 12582912,
        seqFixedBytes: 166438656,
        seqPerToken: 0.0625,
        weightsGiB: 15.92,
      },
    },
  }
}

/** An adapter whose single spec carries an SM-89 hardware constraint. */
class ConstrainedAdapter extends StubAdapter {
  constructor() {
    super('ninfer')
  }

  parameters(): ParameterSpec[] {
    return [
      {
        key: 'kvDtype',
        label: 'KV cache format',
        description: 'Quantizes the KV cache. Smaller formats fit a longer context.',
        form: {
          kind: 'enum',
          options: [
            { value: 'int8', label: 'int8' },
            { value: 'nvfp4', label: 'nvfp4' },
          ],
        },
        defaultValue: 'int8',
        hardwareConstraint: (value, hw) =>
          value === 'nvfp4' && hw.gpu && hw.gpu.sm < 89
            ? {
                ok: false,
                severity: 'error',
                message: `nvfp4 KV needs SM 89 or newer; this card reports SM ${hw.gpu.sm}.`,
              }
            : { ok: true },
      },
    ]
  }
}

async function seam(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LocalInfer)
  return ctx
}

describe('ctx.localInfer scaffold', () => {
  it('loads into a fresh Context without error and publishes the seam', async () => {
    const ctx = await seam()
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
    expect(ctx.localInfer.registeredEngines()).toEqual([])
    expect(ctx.localInfer.registeredPresets()).toEqual([])
    expect(ctx.localInfer.registeredGuidelines()).toEqual([])
  })

  it('registers an engine and reports it back', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new StubAdapter('ninfer'))
    expect(ctx.localInfer.registeredEngines().map(engine => engine.id)).toEqual(['ninfer'])
  })

  it('rejects an empty engine id without publishing anything', async () => {
    const ctx = await seam()
    expect(() => ctx.localInfer.registerEngine(new StubAdapter('  ')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_INVALID_ENGINE' }))
    expect(ctx.localInfer.registeredEngines()).toEqual([])
  })

  it('rejects a duplicate engine id', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new StubAdapter('ninfer'))
    expect(() => ctx.localInfer.registerEngine(new StubAdapter('ninfer')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_CONFLICT' }))
  })

  it('registers a preset keyed by its exact triple and rejects a duplicate', async () => {
    const ctx = await seam()
    ctx.localInfer.registerPreset(preset('ninfer', 'qwen3-27b', '24g-sm86'))
    expect(ctx.localInfer.registeredPresets()).toHaveLength(1)
    expect(() => ctx.localInfer.registerPreset(preset('ninfer', 'qwen3-27b', '24g-sm86')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_CONFLICT' }))
    // A different model in the same triple slot is a distinct preset.
    ctx.localInfer.registerPreset(preset('ninfer', 'qwen3-35b', '24g-sm86'))
    expect(ctx.localInfer.registeredPresets()).toHaveLength(2)
  })

  it('registers a guideline and rejects a duplicate id', async () => {
    const ctx = await seam()
    ctx.localInfer.registerGuideline(guideline('nvfp4-needs-sm89'))
    expect(ctx.localInfer.registeredGuidelines()).toHaveLength(1)
    expect(() => ctx.localInfer.registerGuideline(guideline('nvfp4-needs-sm89')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_CONFLICT' }))
  })

  it('releases a reservation when its disposer runs', async () => {
    const ctx = await seam()
    const dispose = ctx.localInfer.registerEngine(new StubAdapter('ninfer'))
    expect(ctx.localInfer.registeredEngines()).toHaveLength(1)
    dispose()
    expect(ctx.localInfer.registeredEngines()).toEqual([])
    // The same id is free again, proving the reservation was released.
    expect(() => ctx.localInfer.registerEngine(new StubAdapter('ninfer'))).not.toThrow()
  })

  it('fails loudly on the orchestration entry points a later phase fills in', async () => {
    const ctx = await seam()
    const plan: LaunchPlan = { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    await expect(ctx.localInfer.deps(new StubAdapter('ninfer'), 'docker', HW)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
    await expect(ctx.localInfer.installString(new StubAdapter('ninfer'), 'docker', HW)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
    await expect(ctx.localInfer.runInstall(new StubAdapter('ninfer'), 'docker', HW)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
    await expect(ctx.localInfer.launch(plan)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
    await expect(ctx.localInfer.registerModel(plan)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
  })

  it('registers a VramModel keyed by id and rejects duplicates and empty ids', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    expect(ctx.localInfer.registeredVramModels().map(model => model.id)).toEqual(['qwen3-27b'])
    expect(() => ctx.localInfer.registerVramModel(vramModel('qwen3-27b')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_CONFLICT' }))
    expect(() => ctx.localInfer.registerVramModel(vramModel('  ')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_INVALID_MODEL' }))
    // The disposer releases the id, proving the reservation was made.
    const dispose = ctx.localInfer.registerVramModel(vramModel('qwen3-35b'))
    dispose()
    expect(ctx.localInfer.registeredVramModels()).toHaveLength(1)
  })

  it('estimates a config against the registered model and the detected hardware', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const result = await ctx.localInfer.estimate(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144 },
      { ...HW, gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 } },
    )
    // The engine's own refusal figure for this config: KV + sequence state +
    // workspace + graph, on top of the resident weights.
    expect(result.breakdown.kv + result.breakdown.overhead + result.breakdown.workspace)
      .toBe(9197389568)
    expect(result.source).toBe('measured')
    expect(result.verdict.status).toBe('over')
  })

  it('estimates not-measured when no VramModel is registered, and falls back to a single model', async () => {
    const ctx = await seam()
    const empty = await ctx.localInfer.estimate({ model: 'qwen3-27b', kvDtype: 'int8' }, HW)
    expect(empty.verdict.status).toBe('not-measured')
    expect(empty.source).toBe('not-measured')

    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    // No model named in the config: the single registered model is used.
    const unnamed = await ctx.localInfer.estimate({ kvDtype: 'int8', maxContext: 4096 }, HW)
    expect(unnamed.source).toBe('measured')
    // A model id no provider registered stays not-measured.
    const unknown = await ctx.localInfer.estimate({ model: 'qwen3-99b', kvDtype: 'int8' }, HW)
    expect(unknown.verdict.status).toBe('not-measured')
  })

  it('detects the host hardware from the live probes', async () => {
    const ctx = await seam()
    const profile = await ctx.localInfer.detectHardware()
    expect(profile.os).toBe('linux')
    expect(profile.cpuThreads).toBeGreaterThan(0)
    expect(typeof profile.dockerAvailable).toBe('boolean')
    expect(typeof profile.wsl2).toBe('boolean')
    // The probe results feed the same pure mapping the core suite pins.
    const probes = await runHardwareProbes()
    expect(probes.os).toBe('linux')
    expect(probes.cpuThreads).toBe(profile.cpuThreads)
  })
})

describe('ctx.localInfer guidelines', () => {
  const HW86: HardwareProfile = {
    ...HW,
    gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
  }

  it('returns an empty list when no rule can fire', async () => {
    const ctx = await seam()
    expect(await ctx.localInfer.guidelines({}, HW)).toEqual([])
  })

  it('runs a per-spec hardwareConstraint of a registered engine', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new ConstrainedAdapter())
    const results = await ctx.localInfer.guidelines({ kvDtype: 'nvfp4' }, HW86)
    expect(results).toEqual([
      {
        id: 'constraint:kvDtype',
        level: 'error',
        message: expect.stringContaining('SM 89'),
        anchors: ['kvDtype'],
      },
    ])
    // The same spec on an SM-89 card stays silent.
    const hw89 = { ...HW86, gpu: { name: 'NVIDIA GeForce RTX 4090', vramGiB: 24, sm: 89 } }
    expect(await ctx.localInfer.guidelines({ kvDtype: 'nvfp4' }, hw89)).toEqual([])
  })

  it('runs a registered named guideline', async () => {
    const ctx = await seam()
    ctx.localInfer.registerGuideline({
      id: 'docker-not-installed',
      level: 'error',
      message: 'Docker is selected but not installed.',
      when: (config, hw) => !hw.dockerAvailable && config.buildMode === 'docker',
    })
    const results = await ctx.localInfer.guidelines({ buildMode: 'docker' }, HW)
    expect(results).toEqual([
      { id: 'docker-not-installed', level: 'error', message: 'Docker is selected but not installed.' },
    ])
  })

  it('fires the estimator-backed exceeds-usable rule in agreement with the estimate', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144 }
    const model = ctx.localInfer.registeredVramModels()[0]
    const estimate = estimateVram(model, config, HW86)
    expect(estimate.verdict.status).toBe('over')

    const results = await ctx.localInfer.guidelines(config, HW86)
    const over = results.find((result) => result.id === 'vram-exceeds-usable')
    expect(over?.level).toBe('error')
    expect(over?.anchors).toEqual(['maxContext'])
    // The rule readout names the estimator's own solver answer, so the
    // warning and the Phase 2 meter cannot disagree.
    expect(over?.message).toContain(
      `the largest fitting context is ${estimate.breakdown.largestFittingContext}`,
    )
  })

  it('fires the draft-weights rule for a spec the model never measured', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'mtp' }
    const results = await ctx.localInfer.guidelines(config, HW)
    const specRule = results.find((result) => result.id === 'spec-needs-draft-weights')
    expect(specRule?.level).toBe('error')
    expect(specRule?.anchors).toEqual(['spec'])
    expect(specRule?.message).toContain('qwen3-27b')
  })

  it('stays silent on a fit with a measured spec', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const results = await ctx.localInfer.guidelines(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'none' },
      HW86,
    )
    expect(results).toEqual([])
  })
})
