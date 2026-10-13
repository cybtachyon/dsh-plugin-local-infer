import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EngineAdapter } from '@dsh/dsh-plugin-local-infer-core'
import type {
  Config,
  DeployResult,
  Guideline,
  HardwareProfile,
  HealthResult,
  LaunchPlan,
  ParameterSpec,
  Preset,
} from '@dsh/dsh-plugin-local-infer-core'
import LocalInfer, { LocalInferError } from '../src/index.ts'

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

  it('fails loudly on the orchestration entry points until a later phase fills them', async () => {
    const ctx = await seam()
    const plan: LaunchPlan = { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    await expect(ctx.localInfer.estimate({}, HW)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
    await expect(ctx.localInfer.guidelines({}, HW)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_NOT_IMPLEMENTED' }),
    )
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
})
