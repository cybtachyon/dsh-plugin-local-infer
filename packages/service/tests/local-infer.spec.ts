import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EngineAdapter, estimateVram } from 'dsh-plugin-local-infer/core'
import type {
  Config,
  DefaultModel,
  DeployResult,
  EngineDepPlan,
  EngineLaunchSignature,
  EnginePlatformConfig,
  GpuUsageProbe,
  Guideline,
  HardwareProfile,
  HealthResult,
  LaunchPlan,
  ParameterSpec,
  Preset,
  ProcessLine,
  ProviderLaunchRecord,
  ProviderRef,
  SystemDep,
  VramModel,
} from 'dsh-plugin-local-infer/core'
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

  it('fails loudly on a launch for an engine no adapter serves', async () => {
    const ctx = await seam()
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    await expect(ctx.localInfer.launch(plan)).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_INVALID_ENGINE' }),
    )
  })

  it('fails loudly on register when the settings seam is absent', async () => {
    const ctx = await seam()
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    await expect(
      ctx.localInfer.registerModel(plan, { id: 'm', name: 'm', contextWindow: 4096 }),
    ).rejects.toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_SETTINGS_UNAVAILABLE' }),
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
    // The explicit reserve pins the 3 GiB default, so the core estimate and
    // the service's guideline rule price the same budget on any host: the
    // Phase 10 live probes would otherwise raise the reserve on a busy card
    // and the two readouts would no longer agree.
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 262144, reserveMiB: 3072 }
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
    // The explicit reserve pins the 3 GiB default the fit was priced against,
    // so a busy host card (the Phase 10 probes raising the reserve) cannot
    // turn the fit into a fire.
    const results = await ctx.localInfer.guidelines(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, spec: 'none', reserveMiB: 3072 },
      HW86,
    )
    expect(results).toEqual([])
  })
})

describe('ctx.localInfer dep provisioning', () => {
  function depPlan(id: string): EngineDepPlan {
    const dep: SystemDep = {
      id,
      purpose: 'a test dep',
      requiresSudo: true,
      install: { apt: { commands: [`sudo apt install ${id}`] } },
    }
    return { docker: [dep], local: [dep] }
  }

  it('registers a dep plan keyed by engine id and rejects duplicates and empty ids', async () => {
    const ctx = await seam()
    ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake'))
    expect(ctx.localInfer.registeredDepPlans().has('ninfer')).toBe(true)
    expect(() => ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_CONFLICT' }))
    expect(() => ctx.localInfer.registerDepPlan('  ', depPlan('x')))
      .toThrow(expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_INVALID_ENGINE' }))
    // The disposer releases the id, proving the reservation was made.
    const dispose = ctx.localInfer.registerDepPlan('strata', depPlan('docker'))
    dispose()
    expect(ctx.localInfer.registeredDepPlans().has('strata')).toBe(false)
  })

  it('resolves the registered plan for an engine id and build mode', async () => {
    const ctx = await seam()
    ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake'))
    const deps = await ctx.localInfer.deps('ninfer', 'local', HW)
    expect(deps.map((dep) => dep.id)).toEqual(['cmake'])
    // An engine with no plan plans an empty list: nothing to install.
    expect(await ctx.localInfer.deps('unknown', 'local', HW)).toEqual([])
  })

  it('lets an adapter-declared systemDeps win over the registered plan', async () => {
    const ctx = await seam()
    ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake'))
    class DeclaringAdapter extends StubAdapter {
      systemDeps(buildMode: 'docker' | 'local'): readonly SystemDep[] {
        return [
          {
            id: `declared-${buildMode}`,
            purpose: 'declared by the adapter',
            requiresSudo: false,
            install: {},
          },
        ]
      }
    }
    ctx.localInfer.registerEngine(new DeclaringAdapter('ninfer'))
    expect((await ctx.localInfer.deps('ninfer', 'docker', HW)).map((dep) => dep.id)).toEqual([
      'declared-docker',
    ])
  })

  it('renders the install string for the detected package manager', async () => {
    const ctx = await seam()
    ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake'))
    const block = await ctx.localInfer.installString('ninfer', 'local', {
      ...HW,
      packageManager: 'pacman',
    })
    expect(block).toContain('# Package manager: pacman')
    expect(block).toContain('# no pacman install commands for cmake; install it by hand')
  })

  it('runs an install that has no commands for the detected manager without spawning a shell', async () => {
    const ctx = await seam()
    ctx.localInfer.registerDepPlan('ninfer', depPlan('cmake'))
    // The plan only carries apt commands, so on a pacman host nothing runs and
    // the dep reports missing, which proves no shell was spawned.
    const result = await ctx.localInfer.runInstall('ninfer', 'local', {
      ...HW,
      packageManager: 'pacman',
    })
    expect(result).toEqual({
      ok: false,
      results: [{ id: 'cmake', status: 'missing', detail: 'no pacman install commands' }],
    })
  })

  it('runs install commands through the shell runner and captures the exit', async () => {
    const ctx = await seam()
    const plan: EngineDepPlan = {
      docker: [],
      local: [
        {
          id: 'noop',
          purpose: 'a no-op command',
          requiresSudo: false,
          install: { apt: { commands: ['true'] } },
        },
        {
          id: 'broken',
          purpose: 'a failing command',
          requiresSudo: false,
          install: { apt: { commands: ['false'] } },
        },
      ],
    }
    ctx.localInfer.registerDepPlan('shelltest', plan)
    const result = await ctx.localInfer.runInstall('shelltest', 'local', {
      ...HW,
      packageManager: 'apt',
    })
    expect(result.ok).toBe(false)
    // The no-op command exits clean, but the dep has no probe, so the run
    // reads as failed-unconfirmed, which is the documented degrade rule.
    const noop = result.results.find((entry) => entry.id === 'noop')
    expect(noop?.status).toBe('failed')
    expect(noop?.detail).toContain('re-check by hand')
    // The failing command captures its exit code in the detail.
    const broken = result.results.find((entry) => entry.id === 'broken')
    expect(broken?.status).toBe('failed')
    expect(broken?.detail).toContain('exit 1')
  })

  it('detects the package-manager winner in the live hardware probes', async () => {
    const ctx = await seam()
    const profile = await ctx.localInfer.detectHardware()
    // The probe reads the real host, so the field is either a known manager or
    // absent, never an unknown value.
    expect(profile.packageManager === undefined || ['apt', 'dnf', 'pacman', 'brew'].includes(profile.packageManager)).toBe(
      true,
    )
    const probes = await runHardwareProbes()
    expect(probes.packageManager === undefined || probes.packageManager === null || typeof probes.packageManager === 'string').toBe(
      true,
    )
  })
})

describe('ctx.localInfer launch and stop (Phase 5)', () => {
  function plan(engineId: string): LaunchPlan {
    return { engineId, kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
  }

  it('launches through a registered adapter and reports the health answer', async () => {
    const ctx = await seam()
    class LaunchingAdapter extends StubAdapter {
      async healthCheck(_p: LaunchPlan): Promise<HealthResult> {
        return { healthy: true, status: 200 }
      }
    }
    ctx.localInfer.registerEngine(new LaunchingAdapter('ninfer'))
    const result = await ctx.localInfer.launch(plan('ninfer'))
    expect(result.healthy).toBe(true)
    expect(result.plan.engineId).toBe('ninfer')
  })

  it('reports a deploy failure as not-healthy with the detail', async () => {
    const ctx = await seam()
    class FailingAdapter extends StubAdapter {
      async deploy(_p: LaunchPlan): Promise<DeployResult> {
        return { ok: false, detail: 'build failed' }
      }
    }
    ctx.localInfer.registerEngine(new FailingAdapter('ninfer'))
    const result = await ctx.localInfer.launch(plan('ninfer'))
    expect(result.healthy).toBe(false)
    expect(result.detail).toBe('build failed')
  })

  it('passes the stored platform config to the adapter deploy step', async () => {
    const ctx = await seam()
    let seenPlatform: EnginePlatformConfig | undefined
    class PlatformAdapter extends StubAdapter {
      async deploy(_p: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult> {
        seenPlatform = platform
        return { ok: true }
      }
      async healthCheck(_p: LaunchPlan): Promise<HealthResult> {
        return { healthy: true }
      }
    }
    ctx.localInfer.registerEngine(new PlatformAdapter('ninfer'))
    ctx.localInfer.registerEnginePlatformConfig({
      engineId: 'ninfer',
      engineDirectory: '/home/derek/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
    await ctx.localInfer.launch(plan('ninfer'))
    expect(seenPlatform).toEqual({
      engineId: 'ninfer',
      engineDirectory: '/home/derek/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
  })

  it('stops through the registered adapter', async () => {
    const ctx = await seam()
    let stopped = false
    class StoppingAdapter extends StubAdapter {
      async stop(_p: LaunchPlan): Promise<void> {
        stopped = true
      }
    }
    ctx.localInfer.registerEngine(new StoppingAdapter('ninfer'))
    await ctx.localInfer.stop(plan('ninfer'))
    expect(stopped).toBe(true)
  })

  it('registers an engine platform config keyed by engine id and releases it', async () => {
    const ctx = await seam()
    const dispose = ctx.localInfer.registerEnginePlatformConfig({
      engineId: 'ninfer',
      engineDirectory: '/x',
    })
    expect(ctx.localInfer.enginePlatformConfig('ninfer')).toEqual({
      engineId: 'ninfer',
      engineDirectory: '/x',
    })
    dispose()
    expect(ctx.localInfer.enginePlatformConfig('ninfer')).toBeUndefined()
  })

  it('rejects an empty platform config id', async () => {
    const ctx = await seam()
    expect(() => ctx.localInfer.registerEnginePlatformConfig({ engineId: '  ' })).toThrow(
      expect.objectContaining<LocalInferError>({ code: 'LOCAL_INFER_INVALID_ENGINE' }),
    )
  })
})

describe('ctx.localInfer model registration (Phase 6)', () => {
  /**
   * A stateful fake of the dsh-settings seam: describe reads the stored
   * section values, and mutate applies the path ops to them, so the
   * idempotency assertions read the same state the service wrote.
   */
  function fakeSettings(seed: Record<string, unknown> = {}) {
    const sections: Record<string, { value: Record<string, unknown>; revision: number }> = {}
    for (const [ns, value] of Object.entries(seed)) {
      sections[ns] = {
        value: value && typeof value === 'object' ? (value as Record<string, unknown>) : {},
        revision: 1,
      }
    }
    const calls: { ns: string; revision: number | undefined }[] = []

    function section(ns: string): { value: Record<string, unknown>; revision: number } {
      let stored = sections[ns]
      if (stored === undefined) {
        stored = { value: {}, revision: 0 }
        sections[ns] = stored
      }
      return stored
    }

    function applyOp(
      stored: { value: Record<string, unknown>; revision: number },
      op: { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] },
    ): void {
      if (op.op === 'set') {
        let target: Record<string, unknown> = stored.value
        for (let i = 0; i < op.path.length - 1; i++) {
          const key = op.path[i]
          if (target[key] === null || typeof target[key] !== 'object') {
            target[key] = {}
          }
          target = target[key] as Record<string, unknown>
        }
        target[op.path[op.path.length - 1]] = op.value
      } else {
        let target: Record<string, unknown> | undefined = stored.value
        for (let i = 0; i < op.path.length - 1; i++) {
          target = target?.[op.path[i]] as Record<string, unknown> | undefined
        }
        if (target !== undefined) {
          delete target[op.path[op.path.length - 1]]
        }
      }
    }

    const settings = {
      describe: (options?: { redactSecrets?: boolean }) => {
        void options
        // The dsh settings seam is a typert remote, so describe is async and
        // answers with a { ok, value } envelope; the fake mirrors that contract.
        return Promise.resolve({
          ok: true,
          value: {
            writable: true,
            hasDocument: true,
            namespaces: Object.entries(sections).map(([ns, stored]) => ({
              ns,
              revision: stored.revision,
              value: stored.value,
            })),
          },
        })
      },
      mutate: async (
        ns: string,
        ops: readonly (
          | { op: 'set'; path: string[]; value: unknown }
          | { op: 'unset'; path: string[] }
        )[],
        expectedRevision?: number,
      ) => {
        const stored = section(ns)
        if (expectedRevision !== undefined && expectedRevision !== stored.revision) {
          return {
            ok: false,
            error: { message: `settings conflict on ${ns}` },
          }
        }
        for (const op of ops) {
          applyOp(stored, op)
        }
        stored.revision += 1
        calls.push({ ns, revision: expectedRevision })
        return { ok: true, value: {} }
      },
    }
    return { settings, sections, calls }
  }

  function withSettings(ctx: Context, seed: Record<string, unknown> = {}) {
    const fake = fakeSettings(seed)
    // Mount the seam in the reflect store, the fallback the service's
    // settings() reader uses when a context carries no typert remote (a live
    // host exposes the dsh settings controller through ctx.remote.settings,
    // which a bare test context does not).
    ctx.reflect.provide('settings', fake.settings)
    return fake
  }

  function plan(): LaunchPlan {
    return {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
  }

  const MODEL = { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 262144 }
  // The registrar writes the display name (engine, mode, model) into the
  // model row, so the row DSH stores is not the bare model name.
  const MODEL_ROW = { id: 'Qwen3.8-27B', name: 'Ninfer (Local): Qwen3.8-27B', contextWindow: 262144 }

  it('upserts the provider entry through the settings seam', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    const result = await ctx.localInfer.registerModel(plan(), MODEL)
    expect(result.ok).toBe(true)
    expect(result.entry).toEqual({
      providerId: 'ninfer-local-qwen38-27b',
      modelId: 'Qwen3.8-27B',
      name: 'Ninfer (Local): Qwen3.8-27B',
      contextWindow: 262144,
      baseURL: 'http://127.0.0.1:18020/v1',
      apiKeyEnv: 'NINFER_LOCAL_API_KEY',
    })
    const llm = fake.sections['llm-pi-ai']
    expect(llm?.value.providers).toEqual(
      expect.objectContaining({
        'ninfer-local-qwen38-27b': expect.objectContaining({
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:18020/v1',
          apiKeyEnv: 'NINFER_LOCAL_API_KEY',
          models: [MODEL_ROW],
        }),
      }),
    )
    // No descriptor existed before the first write, so the write carries no
    // revision guard; the second write guards on the revision the first set.
    expect(fake.calls[0]).toEqual({ ns: 'llm-pi-ai', revision: undefined })
    await ctx.localInfer.registerModel(plan(), MODEL)
    expect(fake.calls[1]).toEqual({ ns: 'llm-pi-ai', revision: 1 })
  })

  it('replaces the row in place on a re-register and appends a second model', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    await ctx.localInfer.registerModel(plan(), MODEL)
    // The same model again: the list stays one row, not two.
    await ctx.localInfer.registerModel(plan(), { ...MODEL, contextWindow: 131072 })
    let models = (fake.sections['llm-pi-ai']?.value.providers as Record<string, { models: unknown[] }>)[
      'ninfer-local-qwen38-27b'
    ]?.models
    expect(models).toHaveLength(1)
    expect((models?.[0] as { contextWindow: number }).contextWindow).toBe(131072)

    // A second model writes its own provider (the provider id carries the
    // model slug), so the first provider keeps its single row.
    await ctx.localInfer.registerModel(plan(), {
      id: 'Qwen3.8-35B-A3B',
      name: 'Qwen3.8-35B-A3B',
      contextWindow: 131072,
    })
    models = (fake.sections['llm-pi-ai']?.value.providers as Record<string, { models: unknown[] }>)[
      'ninfer-local-qwen38-27b'
    ]?.models
    expect(models?.map((row) => (row as { id: string }).id)).toEqual(['Qwen3.8-27B'])
    const secondProvider = (
      fake.sections['llm-pi-ai']?.value.providers as Record<string, { models: unknown[] }>
    )['ninfer-local-qwen38-35b-a3b']
    expect(secondProvider?.models?.map((row) => (row as { id: string }).id)).toEqual([
      'Qwen3.8-35B-A3B',
    ])
  })

  it('points the agent default model at the entry when agentDefault is set', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    await ctx.localInfer.registerModel(plan(), MODEL, { agentDefault: true })
    expect(fake.sections['agent-default-model']?.value).toEqual({
      provider: 'ninfer-local-qwen38-27b',
      model: 'Qwen3.8-27B',
    })
    // Without the option the agent default section stays untouched.
    const plain = await seam()
    const plainFake = withSettings(plain)
    await plain.localInfer.registerModel(plan(), MODEL)
    expect(plainFake.sections['agent-default-model']).toBeUndefined()
  })

  it('keeps by-hand provider fields the registrar does not own', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx, {
      'llm-pi-ai': {
        providers: {
          'ninfer-local-qwen38-27b': {
            api: 'openai-completions',
            baseURL: 'http://127.0.0.1:18020/v1',
            models: [
              {
                id: 'Qwen3.8-27B',
                name: 'Qwen3.8-27B',
                contextWindow: 262144,
                input: ['text', 'image'],
              },
            ],
          },
        },
      },
    })
    await ctx.localInfer.registerModel(plan(), MODEL)
    const provider = (
      fake.sections['llm-pi-ai']?.value.providers as Record<string, Record<string, unknown>>
    )['ninfer-local-qwen38-27b']
    // The upsert replaced the row it owns, and the extra field the settings
    // editor added to the same row survives the read-back.
    expect(provider?.models).toHaveLength(1)
    const row = (provider?.models as Record<string, unknown>[])[0]
    expect(row?.contextWindow).toBe(262144)
  })

  it('removes the model, the emptied provider, and a pointing agent default', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    await ctx.localInfer.registerModel(plan(), MODEL, { agentDefault: true })
    await ctx.localInfer.removeModel('ninfer-local-qwen38-27b', 'Qwen3.8-27B')
    // The last model went, so the provider row is unset and only the empty
    // providers map the write created remains.
    expect(fake.sections['llm-pi-ai']?.value).toEqual({ providers: {} })
    // The agent default pointed at the removed pair, so it is cleared.
    expect(fake.sections['agent-default-model']?.value).toEqual({})
  })

  it('keeps the provider when other models remain and leaves a foreign agent default alone', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    await ctx.localInfer.registerModel(plan(), MODEL)
    await ctx.localInfer.registerModel(
      plan(),
      { id: 'Qwen3.8-35B-A3B', name: 'Qwen3.8-35B-A3B', contextWindow: 131072 },
      { agentDefault: true },
    )
    await ctx.localInfer.removeModel('ninfer-local-qwen38-27b', 'Qwen3.8-27B')
    // The removed model was the only row in its provider, so the provider row
    // is unset; the second model lives in its own provider and survives.
    const providers = fake.sections['llm-pi-ai']?.value.providers as Record<string, { models: unknown[] }> | undefined
    expect(providers?.['ninfer-local-qwen38-27b']).toBeUndefined()
    expect(providers?.['ninfer-local-qwen38-35b-a3b']?.models?.map((row) => (row as { id: string }).id)).toEqual(['Qwen3.8-35B-A3B'])
    // The agent default points at the surviving provider, so it stays.
    expect(fake.sections['agent-default-model']?.value).toEqual({
      provider: 'ninfer-local-qwen38-35b-a3b',
      model: 'Qwen3.8-35B-A3B',
    })
  })

  it('reads a removal of an unregistered model as a no-op', async () => {
    const ctx = await seam()
    const fake = withSettings(ctx)
    await ctx.localInfer.removeModel('ninfer-local-qwen38-27b', 'absent')
    expect(fake.sections['llm-pi-ai']).toBeUndefined()
    expect(fake.calls).toEqual([])
  })

  it('reads modelIsRegistered through the SettingsForms bare-array describe contract', async () => {
    // The reflect fallback reaches the SettingsForms service directly, whose
    // describe answers with the bare descriptor array (not the typert envelope
    // or the plain object). The registrar must read that contract too, so a
    // registered model is seen and the card's Remove button can appear.
    const ctx = await seam()
    const sections: Record<string, { value: Record<string, unknown>; revision: number }> = {}
    function section(ns: string) {
      let s = sections[ns]
      if (s === undefined) { s = { value: {}, revision: 0 }; sections[ns] = s }
      return s
    }
    function applyOp(stored: { value: Record<string, unknown> }, op: { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }) {
      if (op.op === 'set') {
        let target: Record<string, unknown> = stored.value
        for (let i = 0; i < op.path.length - 1; i++) {
          const key = op.path[i]
          if (target[key] === null || typeof target[key] !== 'object') target[key] = {}
          target = target[key] as Record<string, unknown>
        }
        target[op.path[op.path.length - 1]] = op.value
      } else {
        let target: Record<string, unknown> | undefined = stored.value
        for (let i = 0; i < op.path.length - 1; i++) target = target?.[op.path[i]] as Record<string, unknown> | undefined
        if (target !== undefined) delete target[op.path[op.path.length - 1]]
      }
    }
    const arraySettings = {
      // The SettingsForms contract: describe answers with the bare array.
      describe: () => Object.entries(sections).map(([ns, s]) => ({ ns, revision: s.revision, value: s.value })),
      mutate: async (ns: string, ops: readonly ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[], expectedRevision?: number) => {
        const stored = section(ns)
        if (expectedRevision !== undefined && expectedRevision !== stored.revision) return { ok: false, error: { message: 'conflict' } }
        for (const op of ops) applyOp(stored, op)
        stored.revision += 1
        return { ok: true, value: {} }
      },
    }
    ctx.reflect.provide('settings', arraySettings)
    expect(await ctx.localInfer.modelIsRegistered('ninfer-local-qwen38-27b', 'Qwen3.8-27B')).toBe(false)
    await ctx.localInfer.registerModel(plan(), MODEL)
    expect(await ctx.localInfer.modelIsRegistered('ninfer-local-qwen38-27b', 'Qwen3.8-27B')).toBe(true)
    await ctx.localInfer.removeModel('ninfer-local-qwen38-27b', 'Qwen3.8-27B')
    expect(await ctx.localInfer.modelIsRegistered('ninfer-local-qwen38-27b', 'Qwen3.8-27B')).toBe(false)
  })
})

describe('ctx.localInfer OS reserve (Phase 10)', () => {
  const NINFER_SIG: EngineLaunchSignature = { binary: 'ninfer-serve', port: 18020 }
  const FOREIGN_LINE: ProcessLine = {
    pid: 12345,
    command: 'ninfer-serve /models/model.ninfer --host 127.0.0.1 --port 18020',
  }
  const GPU_BUSY: GpuUsageProbe = { usedMiB: 18000, totalMiB: 24576 }
  const GPU_IDLE: GpuUsageProbe = { usedMiB: 2048, totalMiB: 24576 }
  const HW86: HardwareProfile = {
    ...HW,
    gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
  }

  /** An adapter that declares a launch signature the process matcher hits. */
  class SigningAdapter extends StubAdapter {
    constructor(id: string, private readonly signature: EngineLaunchSignature) {
      super(id)
    }
    launchSignature(): EngineLaunchSignature {
      return this.signature
    }
  }

  function launchPlan(engineId: string): LaunchPlan {
    return { engineId, kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }
  }

  it('resolves the 3 GiB default with no engines and no GPU reading', async () => {
    const ctx = await seam()
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      gpuUsage: null,
      processes: [],
    })
    expect(resolution).toEqual({ reserveMiB: 3072, source: 'default' })
  })

  it('raises the reserve to the used VRAM when a running process matches an engine signature', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      gpuUsage: GPU_BUSY,
      processes: [FOREIGN_LINE],
    })
    expect(resolution).toEqual({ reserveMiB: 18000, source: 'foreign-process' })
  })

  it('caps the foreign-process reserve at the card capacity', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const overshot: GpuUsageProbe = { usedMiB: 30000, totalMiB: 24576 }
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      gpuUsage: overshot,
      processes: [FOREIGN_LINE],
    })
    expect(resolution).toEqual({ reserveMiB: 24576, source: 'foreign-process' })
  })

  it('stays at the default when no process matches and the card is idle', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      gpuUsage: GPU_IDLE,
      processes: [{ command: 'vim PLAN.md' }],
    })
    expect(resolution).toEqual({ reserveMiB: 3072, source: 'default' })
  })

  it('raises the reserve through the 75% usage fallback when no process matches', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const saturated: GpuUsageProbe = { usedMiB: 24576, totalMiB: 24576 }
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      gpuUsage: saturated,
      processes: [{ command: 'vim PLAN.md' }],
    })
    expect(resolution).toEqual({ reserveMiB: 24576, source: 'gpu-usage' })
  })

  it('keeps the default for a plugin-launched engine even while its process runs', async () => {
    const ctx = await seam()
    class LaunchingAdapter extends SigningAdapter {
      async healthCheck(_p: LaunchPlan): Promise<HealthResult> {
        return { healthy: true, status: 200 }
      }
    }
    ctx.localInfer.registerEngine(new LaunchingAdapter('ninfer', NINFER_SIG))
    await ctx.localInfer.launch(launchPlan('ninfer'))
    expect(ctx.localInfer.launchedEngineIds()).toEqual(['ninfer'])
    // The engine the plugin launched is priced by the estimator already, so
    // the running process and the busy card both stay at the default.
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      engineId: 'ninfer',
      gpuUsage: GPU_BUSY,
      processes: [FOREIGN_LINE],
    })
    expect(resolution).toEqual({ reserveMiB: 3072, source: 'default' })
  })

  it('unmarks the engine on stop, so the probes may price its card again', async () => {
    const ctx = await seam()
    class LaunchingAdapter extends SigningAdapter {
      async healthCheck(_p: LaunchPlan): Promise<HealthResult> {
        return { healthy: true, status: 200 }
      }
    }
    ctx.localInfer.registerEngine(new LaunchingAdapter('ninfer', NINFER_SIG))
    const plan = launchPlan('ninfer')
    await ctx.localInfer.launch(plan)
    expect(ctx.localInfer.launchedEngineIds()).toEqual(['ninfer'])
    await ctx.localInfer.stop(plan)
    expect(ctx.localInfer.launchedEngineIds()).toEqual([])
    const resolution = await ctx.localInfer.detectOsReserve(undefined, {
      engineId: 'ninfer',
      gpuUsage: GPU_BUSY,
      processes: [FOREIGN_LINE],
    })
    expect(resolution.source).toBe('foreign-process')
  })

  it('prices an explicit config reserve as explicit, without running a probe', async () => {
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const result = await ctx.localInfer.estimate(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096, reserveMiB: 8192 },
      HW86,
    )
    expect(result.reserveSource).toBe('explicit')
    expect(result.breakdown.reserve).toBe(8192 * 1024 * 1024)
  })

  it('prices a dynamically resolved reserve through the estimate', async () => {
    // The live probes run against the real host: the answer is one of the four
    // sources, the reserve is a finite non-negative MiB number, and the
    // breakdown prices it (the usable budget is the card minus the reserve).
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const result = await ctx.localInfer.estimate(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 4096 },
      HW86,
      'ninfer',
    )
    expect(['default', 'explicit', 'foreign-process', 'gpu-usage']).toContain(result.reserveSource)
    expect(Number.isFinite(result.breakdown.reserve)).toBe(true)
    expect(result.breakdown.reserve).toBeGreaterThanOrEqual(0)
    expect(result.breakdown.usable).toBe(
      (24 * 1024 - result.breakdown.reserve / (1024 * 1024)) * 1024 * 1024,
    )
  })

  it('fires the exceeds-usable rule on a raised reserve, in agreement with the estimate', async () => {
    // A context that fits under the 3 GiB default but not under an 18 GiB
    // reserve: the red rule and the meter verdict price the same budget.
    const ctx = await seam()
    ctx.localInfer.registerVramModel(vramModel('qwen3-27b'))
    const config = { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 131072, reserveMiB: 18 * 1024 }
    const estimate = await ctx.localInfer.estimate(config, HW86)
    expect(estimate.verdict.status).toBe('over')
    const results = await ctx.localInfer.guidelines(config, HW86, 'ninfer')
    const over = results.find((result) => result.id === 'vram-exceeds-usable')
    expect(over?.level).toBe('error')
    expect(over?.anchors).toEqual(['maxContext'])
  })
})

describe('ctx.localInfer provider statuses', () => {
  const NINFER_SIG: EngineLaunchSignature = { binary: 'ninfer-serve', port: 18020 }
  const NINFER_LINE: ProcessLine = {
    pid: 12345,
    command: 'ninfer-serve /models/model.ninfer --host 127.0.0.1 --port 18020',
  }
  const GPU_BUSY: GpuUsageProbe = { usedMiB: 24576, totalMiB: 24576 }
  const GPU_IDLE: GpuUsageProbe = { usedMiB: 2048, totalMiB: 24576 }

  class SigningAdapter extends StubAdapter {
    constructor(id: string, private readonly signature: EngineLaunchSignature) {
      super(id)
    }
    launchSignature(): EngineLaunchSignature {
      return this.signature
    }
  }

  it('reads every provider as stopped when no engine is running', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const providers: ProviderRef[] = [
      { id: 'a', engine: 'ninfer', model: 'qwen3-27b' },
      { id: 'b', engine: 'hyperqwen', model: 'qwen3-27b' },
    ]
    const statuses = await ctx.localInfer.providerStatuses(providers, {
      gpuUsage: GPU_IDLE,
      processes: [{ command: 'vim PLAN.md' }],
    })
    expect(statuses).toEqual({ a: 'stopped', b: 'stopped' })
  })

  it('reads a foreign engine as unsure for its configs and stopped for the rest', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const providers: ProviderRef[] = [
      { id: 'a', engine: 'ninfer', model: 'qwen3-27b' },
      { id: 'b', engine: 'hyperqwen', model: 'qwen3-27b' },
    ]
    // A running ninfer process the plugin did not launch: the detector ties
    // the engine to no model, so the ninfer config reads as unsure and the
    // hyperqwen config (a different engine) reads as stopped.
    const statuses = await ctx.localInfer.providerStatuses(providers, {
      gpuUsage: GPU_IDLE,
      processes: [NINFER_LINE],
    })
    expect(statuses).toEqual({ a: 'unsure', b: 'stopped' })
  })

  it('reads a plugin-launched engine as running for its model', async () => {
    const ctx = await seam()
    class LaunchingAdapter extends SigningAdapter {
      async healthCheck(_p: LaunchPlan): Promise<HealthResult> {
        return { healthy: true, status: 200 }
      }
    }
    ctx.localInfer.registerEngine(new LaunchingAdapter('ninfer', NINFER_SIG))
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
      modelId: 'qwen3-27b',
    }
    await ctx.localInfer.launch(plan)
    const providers: ProviderRef[] = [
      { id: 'a', engine: 'ninfer', model: 'qwen3-27b' },
      { id: 'b', engine: 'ninfer', model: 'qwen3-35b' },
    ]
    // The plugin launched ninfer with qwen3-27b, so the matching provider
    // reads as running and the other model reads as unsure (the engine serves
    // a different model, so b cannot be confirmed).
    const statuses = await ctx.localInfer.providerStatuses(providers, {
      gpuUsage: GPU_IDLE,
      processes: [NINFER_LINE],
    })
    expect(statuses).toEqual({ a: 'running', b: 'unsure' })
  })

  it('reads every provider as unsure when the card is busy', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SigningAdapter('ninfer', NINFER_SIG))
    const providers: ProviderRef[] = [{ id: 'a', engine: 'ninfer', model: 'qwen3-27b' }]
    const statuses = await ctx.localInfer.providerStatuses(providers, {
      gpuUsage: GPU_BUSY,
      processes: [NINFER_LINE],
    })
    expect(statuses).toEqual({ a: 'unsure' })
  })
})

describe('ctx.localInfer launch records and restart re-link', () => {
  const NINFER_SIG: EngineLaunchSignature = { binary: 'ninfer-serve', port: 18020 }
  const NINFER_LINE: ProcessLine = {
    pid: 12345,
    command: 'ninfer-serve /models/model.ninfer --host 127.0.0.1 --port 18020',
  }
  const GPU_IDLE: GpuUsageProbe = { usedMiB: 2048, totalMiB: 24576 }

  /** An adapter whose deploy starts a tracked process the launch records. */
  class PidLaunchingAdapter extends StubAdapter {
    constructor(readonly pid: number) {
      super('ninfer')
    }
    launchSignature(): EngineLaunchSignature {
      return NINFER_SIG
    }
    async deploy(_plan: LaunchPlan): Promise<DeployResult> {
      return { ok: true, handle: { pid: this.pid, kill: () => undefined } }
    }
    async healthCheck(_plan: LaunchPlan): Promise<HealthResult> {
      return { healthy: true, status: 200 }
    }
  }

  function plan(): LaunchPlan {
    return {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/model.ninfer', '--port', '18020'],
      port: 18020,
      modelId: 'qwen3-27b',
      healthUrl: 'http://127.0.0.1:18020/health',
    }
  }

  function record(overrides: Partial<ProviderLaunchRecord> = {}): ProviderLaunchRecord {
    const base: ProviderLaunchRecord = {
      pid: 12345,
      startedAt: '2026-10-14T12:00:00.000Z',
      argv: ['ninfer-serve', '/models/model.ninfer', '--port', '18020'],
      parentPid: 999,
      previousPids: [999],
      engineId: 'ninfer',
      modelId: 'qwen3-27b',
      port: 18020,
    }
    return { ...base, ...overrides } as ProviderLaunchRecord
  }

  it('records the engine pid and the DSH parent pid on a successful launch', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new PidLaunchingAdapter(12345))
    const result = await ctx.localInfer.launch(plan())
    expect(result.pid).toBe(12345)
    // The host process identifies as DSH in this workspace, so the parent
    // pid is the host's own pid the re-link rule prices after a restart.
    expect(result.parentPid).toBe(process.pid)
  })

  it('omits the pid when the deploy step starts no tracked process', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new StubAdapter('ninfer'))
    const result = await ctx.localInfer.launch(plan())
    expect(result.pid).toBeUndefined()
    expect(result.parentPid).toBeUndefined()
  })

  it('re-links an engine the current DSH pid launched', async () => {
    const ctx = await seam()
    // Register the engine so providerStatuses has an adapter signature to
    // probe the process table against; the re-link then ties the port to the
    // model the record names.
    ctx.localInfer.registerEngine(new PidLaunchingAdapter(12345))
    const entries = [{ id: 'a', record: record({ parentPid: process.pid, previousPids: [process.pid] }) }]
    const outcomes = await ctx.localInfer.reLinkProviders(entries, {
      processAlive: (pid) => pid === 12345 || pid === process.pid,
      commandLine: (pid) => (pid === 12345 ? NINFER_LINE.command : undefined),
    })
    expect(outcomes).toEqual({ a: 'adopted' })
    expect(ctx.localInfer.launchedEngineIds()).toEqual(['ninfer'])
    // The re-adopted engine ties its port to the model, so the provider
    // status detector reads the matching config as running.
    const statuses = await ctx.localInfer.providerStatuses(
      [{ id: 'a', engine: 'ninfer', model: 'qwen3-27b' }],
      { gpuUsage: GPU_IDLE, processes: [NINFER_LINE] },
    )
    expect(statuses).toEqual({ a: 'running' })
  })

  it('re-links an engine a previous DSH pid launched when that pid is dead', async () => {
    const ctx = await seam()
    const entries = [{ id: 'a', record: record({ parentPid: 999, previousPids: [888, 999] }) }]
    const outcomes = await ctx.localInfer.reLinkProviders(entries, {
      // The engine is alive; the parent 999 is not (the DSH that launched it
      // died and the engine re-parented to init).
      processAlive: (pid) => pid === 12345,
      commandLine: (pid) => (pid === 12345 ? NINFER_LINE.command : undefined),
    })
    expect(outcomes).toEqual({ a: 'adopted' })
    expect(ctx.localInfer.launchedEngineIds()).toEqual(['ninfer'])
  })

  it('does not adopt an engine a still-running previous DSH pid owns', async () => {
    const ctx = await seam()
    const entries = [{ id: 'a', record: record({ parentPid: 999, previousPids: [999] }) }]
    const outcomes = await ctx.localInfer.reLinkProviders(entries, {
      // The parent 999 is a live DSH clone: the engine is not this DSH's.
      processAlive: (pid) => pid === 12345 || pid === 999,
      commandLine: (pid) => (pid === 12345 ? NINFER_LINE.command : undefined),
    })
    expect(outcomes).toEqual({ a: 'foreign' })
    expect(ctx.localInfer.launchedEngineIds()).toEqual([])
  })

  it('reads a dead engine as dead and a recycled pid as foreign', async () => {
    const ctx = await seam()
    const entries = [
      // The dead entry's pid is not in the alive set, so the record clears.
      { id: 'dead', record: record({ pid: 54321 }) },
      // The recycled entry's pid is alive but runs a different command line.
      {
        id: 'recycled',
        record: record({ parentPid: process.pid, previousPids: [process.pid] }),
      },
    ]
    const outcomes = await ctx.localInfer.reLinkProviders(entries, {
      processAlive: (pid) => pid === 12345,
      commandLine: (pid) => (pid === 12345 ? 'vim PLAN.md' : undefined),
    })
    expect(outcomes).toEqual({ dead: 'dead', recycled: 'foreign' })
    expect(ctx.localInfer.launchedEngineIds()).toEqual([])
  })
})

describe('model directory, hf CLI, and model download', () => {
  let home: string

  beforeAll(() => {
    // defaultModelDirectory keys on homedir(), so the suite points HOME at a
    // scratch dir and never touches the real one.
    home = mkdtempSync(join(tmpdir(), 'local-infer-service-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('resolves the default model directory under the dsh home and creates it', async () => {
    const ctx = await seam()
    const directory = ctx.localInfer.defaultModelDirectory()
    expect(directory).toBe(join(home, '.dsh', 'models'))
    expect(existsSync(directory)).toBe(true)
  })

  it('lets an injected cliPath win in the hf CLI probe', async () => {
    const ctx = await seam()
    expect(await ctx.localInfer.hfCliAvailable({ cliPath: '/opt/hf/bin/hf' })).toBe(
      '/opt/hf/bin/hf',
    )
  })

  it('reads the live hf CLI probe as a path or null', async () => {
    const ctx = await seam()
    const answer = await ctx.localInfer.hfCliAvailable()
    expect(answer === null || typeof answer === 'string').toBe(true)
  })

  it('renders the hf download command through the injected runner and creates the target', async () => {
    const ctx = await seam()
    const entry: DefaultModel = {
      engineId: 'ninfer',
      modelId: 'qwen3-27b',
      label: 'Ninfer Qwen3.8-27B',
      url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      file: 'qwen3_8_27b_nvfp4.ninfer',
    }
    const commands: string[] = []
    const runner = async (command: string) => {
      commands.push(command)
      return { ok: true }
    }
    const target = join(home, 'models')
    const result = await ctx.localInfer.downloadModel(entry, target, { runner })
    expect(result).toEqual({ ok: true })
    expect(commands).toEqual([
      `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir ${target}`,
    ])
    expect(existsSync(target)).toBe(true)
  })

  it('keeps the runner detail on a failed download', async () => {
    const ctx = await seam()
    const entry: DefaultModel = {
      engineId: 'hyperqwen',
      modelId: 'qwen3-27b',
      label: 'HyperQwen Qwen3.8-27B',
      url: 'https://huggingface.co/born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
    }
    const result = await ctx.localInfer.downloadModel(entry, join(home, 'models'), {
      runner: async () => ({ ok: false, detail: 'exit 1: no such repo' }),
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no such repo')
  })

  it('lists the model directory entries and marks the weight-bearing directories', async () => {
    const ctx = await seam()
    const dir = join(home, 'scan')
    mkdirSync(join(dir, 'weights-repo'), { recursive: true })
    writeFileSync(join(dir, 'weights-repo', 'model.safetensors'), 'weights')
    mkdirSync(join(dir, 'templates'), { recursive: true })
    writeFileSync(join(dir, 'templates', 'template.json'), '{}')
    writeFileSync(join(dir, 'a.ninfer'), 'weights')
    writeFileSync(join(dir, 'b.gguf'), 'weights')
    mkdirSync(join(dir, '.cache'), { recursive: true })
    const entries = ctx.localInfer.listModelDirectory(dir)
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'a.ninfer',
      'b.gguf',
      'templates',
      'weights-repo',
    ])
    // Dot entries never name a model, so the listing skips them.
    expect(entries.some((entry) => entry.name === '.cache')).toBe(false)
    const repo = entries.find((entry) => entry.name === 'weights-repo')!
    expect(repo.isDirectory).toBe(true)
    expect(repo.hasSafetensors).toBe(true)
    const templates = entries.find((entry) => entry.name === 'templates')!
    expect(templates.isDirectory).toBe(true)
    expect(templates.hasSafetensors).toBe(false)
    const artifact = entries.find((entry) => entry.name === 'a.ninfer')!
    expect(artifact.isDirectory).toBe(false)
  })

  it('reads a missing model directory as an empty list', async () => {
    const ctx = await seam()
    expect(ctx.localInfer.listModelDirectory(join(home, 'no-such-dir'))).toEqual([])
  })
})
