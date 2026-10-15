import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EngineAdapter } from 'dsh-plugin-local-infer/core'
import type {
  Config,
  HardwareProfile,
  ParameterSpec,
  Preset,
  PresetSource,
} from 'dsh-plugin-local-infer/core'
import LocalInfer from '../src/index.ts'

const HW: HardwareProfile = {
  dockerAvailable: true,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
  gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
}

/** An adapter whose surface carries two spec defaults the resolver floors on. */
class SurfaceAdapter extends EngineAdapter {
  readonly id = 'ninfer'
  readonly supports = { docker: true, local: true }

  parameters(): ParameterSpec[] {
    return [
      {
        key: 'kvDtype',
        label: 'KV cache format',
        description: 'Quantizes the KV cache.',
        form: { kind: 'enum', options: [{ value: 'int8', label: 'int8' }] },
        defaultValue: 'int8',
      },
      {
        key: 'maxContext',
        label: 'Max context',
        description: 'The longest conversation the engine accepts.',
        form: { kind: 'number', min: 256 },
        defaultValue: 32768,
      },
    ]
  }

  renderLaunch(_config: Config, _hw: HardwareProfile) {
    return { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
  }

  async healthCheck() {
    return { healthy: true }
  }

  async deploy() {
    return { ok: true }
  }

  async stop() {
    /* nothing to stop */
  }
}

function preset(engineId: string, modelId: string, hardwareClass: string, values: Config): Preset {
  return { engineId, modelId, hardwareClass, values, source: 'measured' }
}

async function seam(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LocalInfer)
  return ctx
}

describe('ctx.localInfer.resolveDefaults', () => {
  it('resolves the starting config over the registered presets and the engine surface', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SurfaceAdapter())
    ctx.localInfer.registerPreset(
      preset('ninfer', 'qwen3-27b', '24g-sm86', { kvDtype: 'rk4v4', maxContext: 262144 }),
    )
    const result = await ctx.localInfer.resolveDefaults('ninfer', 'qwen3-27b', HW)
    expect(result.config).toEqual({ kvDtype: 'rk4v4', maxContext: 262144 })
    // The preset supplied both values, so the provenance names it for both.
    expect(result.provenance).toEqual([
      { key: 'kvDtype', source: 'measured' },
      { key: 'maxContext', source: 'measured' },
    ])
  })

  it('floors on the spec defaults when no preset matches the class', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SurfaceAdapter())
    // A preset for a different class does not apply to the 24g-sm86 host.
    ctx.localInfer.registerPreset(preset('ninfer', 'qwen3-27b', '16g-sm80', { kvDtype: 'bf16' }))
    const result = await ctx.localInfer.resolveDefaults('ninfer', 'qwen3-27b', HW)
    expect(result.config).toEqual({ kvDtype: 'int8', maxContext: 32768 })
    expect(result.provenance.every(p => p.source === 'spec-default')).toBe(true)
  })

  it('lets an explicit value beat the preset', async () => {
    const ctx = await seam()
    ctx.localInfer.registerEngine(new SurfaceAdapter())
    ctx.localInfer.registerPreset(
      preset('ninfer', 'qwen3-27b', '24g-sm86', { kvDtype: 'rk4v4' }),
    )
    const result = await ctx.localInfer.resolveDefaults('ninfer', 'qwen3-27b', HW, {
      kvDtype: 'nvfp4',
    })
    expect(result.config.kvDtype).toBe('nvfp4')
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('user')
  })
})

describe('ctx.localInfer.fetchPreset', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-fetch-'))
    process.env.HOME = home
  })

  afterAll(() => {
    delete process.env.HOME
    rmSync(home, { recursive: true, force: true })
  })

  function storePath(): string {
    return join(home, '.dsh', 'local-infer', 'presets.json')
  }

  function stubCli(body: string, exitCode = 0): string {
    const path = join(home, `stub-cli-${Math.random().toString(36).slice(2)}.js`)
    writeFileSync(path, `console.log(${JSON.stringify(body)}); process.exit(${exitCode});\n`)
    return path
  }

  const source: PresetSource = {
    engineId: 'ninfer',
    modelId: 'qwen3-27b',
    hardwareClass: '24g-sm86',
    url: 'https://example.com/ninfer',
    source: 'NInfer docs',
    extract: content => {
      const match = content.match(/```json\s*([\s\S]*?)```/)
      if (match === null || match[1] === undefined) return {}
      try {
        return JSON.parse(match[1]) as Config
      } catch {
        return {}
      }
    },
  }

  it('fetches, extracts, tags, stores, and registers a preset', async () => {
    const ctx = await seam()
    // The real CLI nests the page under results[0].content; the stub mirrors
    // that shape so the integration parsing is the thing under test.
    const cli = stubCli(
      '{"results": [{"content": "```json\\n{ \\"kvDtype\\": \\"int8\\" }\\n```"}]}',
    )
    const result = await ctx.localInfer.fetchPreset(source, { cliPath: cli })
    expect(result.degraded).toBe(false)
    expect(result.stored).toBe(true)
    expect(result.preset?.values).toEqual({ kvDtype: 'int8' })
    expect(result.preset?.source).toBe(source.url)
    expect(result.preset?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The preset is persisted to the store under the dsh home.
    expect(existsSync(storePath())).toBe(true)
    const stored = JSON.parse(readFileSync(storePath(), 'utf8')) as Preset[]
    expect(stored).toHaveLength(1)
    expect(stored[0]?.values).toEqual({ kvDtype: 'int8' })
    // And it is registered, so the next resolveDefaults uses it.
    expect(ctx.localInfer.registeredPresets()).toHaveLength(1)
  })

  it('degrades when the CLI fetch fails', async () => {
    const ctx = await seam()
    const cli = stubCli('', 1)
    const result = await ctx.localInfer.fetchPreset(source, { cliPath: cli })
    expect(result.degraded).toBe(true)
    expect(result.stored).toBe(false)
    expect(result.preset).toBeUndefined()
    expect(result.detail).toMatch(/modsearch fetch failed/)
  })

  it('degrades when no modsearch CLI is available', async () => {
    const ctx = await seam()
    const saved = process.env.MODSEARCH_CLI
    delete process.env.MODSEARCH_CLI
    try {
      // No cliPath option, no MODSEARCH_CLI env, and modsearch is not on PATH,
      // so the bridge reads as unavailable and the built-in presets apply.
      const result = await ctx.localInfer.fetchPreset(source)
      expect(result.degraded).toBe(true)
      expect(result.stored).toBe(false)
      expect(result.detail).toMatch(/not available/)
    } finally {
      if (saved === undefined) {
        delete process.env.MODSEARCH_CLI
      } else {
        process.env.MODSEARCH_CLI = saved
      }
    }
  })

  it('re-fetching a registered triple does not trip the duplicate conflict', async () => {
    const ctx = await seam()
    const cli = stubCli(
      '{"results": [{"content": "```json\\n{ \\"kvDtype\\": \\"int8\\" }\\n```"}]}',
    )
    const first = await ctx.localInfer.fetchPreset(source, { cliPath: cli })
    expect(first.stored).toBe(true)
    // A second fetch of the same triple refreshes in place, not a conflict.
    const second = await ctx.localInfer.fetchPreset(source, { cliPath: cli })
    expect(second.stored).toBe(true)
    expect(ctx.localInfer.registeredPresets()).toHaveLength(1)
  })

  it('resolves the CLI from the MODSEARCH_CLI env when no option is passed', async () => {
    const ctx = await seam()
    const cli = stubCli(
      '{"results": [{"content": "```json\\n{ \\"kvDtype\\": \\"fp8\\" }\\n```"}]}',
    )
    const saved = process.env.MODSEARCH_CLI
    process.env.MODSEARCH_CLI = cli
    try {
      const result = await ctx.localInfer.fetchPreset(source)
      expect(result.degraded).toBe(false)
      expect(result.preset?.values).toEqual({ kvDtype: 'fp8' })
    } finally {
      if (saved === undefined) {
        delete process.env.MODSEARCH_CLI
      } else {
        process.env.MODSEARCH_CLI = saved
      }
    }
  })

  it('treats a blank cliPath as absent, falling through to the env and PATH', async () => {
    const ctx = await seam()
    const saved = process.env.MODSEARCH_CLI
    delete process.env.MODSEARCH_CLI
    try {
      // A blank cliPath trims to empty, so the resolver reads the bridge as
      // unavailable (no env, no PATH modsearch) and degrades.
      const result = await ctx.localInfer.fetchPreset(source, { cliPath: '   ' })
      expect(result.degraded).toBe(true)
      expect(result.detail).toMatch(/not available/)
    } finally {
      if (saved === undefined) {
        delete process.env.MODSEARCH_CLI
      } else {
        process.env.MODSEARCH_CLI = saved
      }
    }
  })

  it('degrades when the CLI emits non-JSON output', async () => {
    const ctx = await seam()
    // A CLI that prints a plain string (not JSON) makes the parse throw, so
    // the fetch degrades with the non-JSON detail.
    const cliPath = join(home, `stub-nonjson-${Math.random().toString(36).slice(2)}.js`)
    writeFileSync(cliPath, "console.log('not json'); process.exit(0);\n")
    const result = await ctx.localInfer.fetchPreset(source, { cliPath })
    expect(result.degraded).toBe(true)
    expect(result.detail).toMatch(/non-JSON/)
  })
})
