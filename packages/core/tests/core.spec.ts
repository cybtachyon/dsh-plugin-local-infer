import { describe, expect, it } from 'vitest'
import { EngineAdapter } from '../src/index.ts'
import type {
  Config,
  DeployResult,
  HealthResult,
  HardwareProfile,
  LaunchPlan,
  ParameterForm,
  ParameterSpec,
} from '../src/index.ts'

const HW: HardwareProfile = { dockerAvailable: false, wsl2: false, os: 'linux', cpuThreads: 4 }
const PLAN: LaunchPlan = { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }

/** A minimal concrete adapter proving the abstract contract is satisfiable. */
class StubAdapter extends EngineAdapter {
  readonly id = 'stub'
  readonly supports = { docker: true, local: true }

  parameters(): ParameterSpec[] {
    return [{
      key: 'maxContext',
      label: 'Max context',
      description: 'Longest conversation the engine will accept.',
      form: { kind: 'number', min: 256 },
    }]
  }

  renderLaunch(_config: Config, _hw: HardwareProfile): LaunchPlan {
    return { kind: 'process', argv: ['stub-serve'], port: 8080, healthUrl: PLAN.healthUrl }
  }

  async healthCheck(_plan: LaunchPlan): Promise<HealthResult> {
    return { healthy: true, status: 200 }
  }

  async deploy(_plan: LaunchPlan): Promise<DeployResult> {
    return { ok: true }
  }

  async stop(_plan: LaunchPlan): Promise<void> {
    /* no local process to stop in the stub */
  }
}

describe('core domain model', () => {
  it('lets a concrete adapter satisfy the EngineAdapter contract', async () => {
    const adapter = new StubAdapter()
    const specs = adapter.parameters()
    expect(specs[0]?.key).toBe('maxContext')
    expect(adapter.renderLaunch({}, HW)).toMatchObject({ kind: 'process', port: 8080 })
    expect(await adapter.deploy(PLAN)).toEqual({ ok: true })
    expect(await adapter.healthCheck(PLAN)).toMatchObject({ healthy: true, status: 200 })
    await expect(adapter.stop(PLAN)).resolves.toBeUndefined()
  })

  it('keeps the form union closed to the six control kinds', () => {
    const forms: ParameterForm[] = [
      { kind: 'boolean' },
      { kind: 'enum', options: [{ value: 'rk4v4', label: 'RK 4/4', note: '31% smaller than rk8v4' }] },
      { kind: 'number', min: 0, max: 8, step: 1 },
      { kind: 'text', placeholder: 'path to a template' },
      { kind: 'path' },
      {
        kind: 'combo',
        options: [{ value: 'froggeric/Qwen-Fixed-Chat-Templates', label: 'Froggeric22', source: 'popular' }],
      },
    ]
    expect(forms.map(form => form.kind)).toEqual(['boolean', 'enum', 'number', 'text', 'path', 'combo'])
  })

  it('accepts a behavior-first spec with a vram contribution and a constraint', () => {
    const spec: ParameterSpec = {
      key: 'kvDtype',
      label: 'KV format',
      description: 'How the KV cache is quantized; smaller fits a longer context.',
      form: { kind: 'enum', options: [{ value: 'bf16', label: 'BF16' }, { value: 'rk4v4', label: 'RK 4/4' }] },
      vramContribution: (_value, ctx) => ({ kv: ctx.ctx * 128 }),
      hardwareConstraint: (_value, hw) => (hw.gpu?.sm === undefined ? { ok: true } : { ok: true }),
    }
    expect(spec.vramContribution?.('rk4v4', { kvDtype: 'rk4v4', ctx: 4096 })).toEqual({ kv: 4096 * 128 })
    expect(spec.hardwareConstraint?.('rk4v4', HW)).toEqual({ ok: true })
  })
})
