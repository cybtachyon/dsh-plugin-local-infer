import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from 'dsh-plugin-local-infer/service'
import localInferProviders, { apply, inject, name } from '../src/index.ts'

describe('local-infer-providers scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-providers')
    expect(inject).toEqual(['localInfer'])
    expect(localInferProviders).toEqual({ name, inject, apply })
  })

  it('loads alongside the service and registers the built-in guidelines', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferProviders)
    // The providers row registers all four engine adapters: the measured
    // NInfer and Hyper-Qwen, the specified llama.cpp, and the placeholder Strata.
    expect(ctx.localInfer.registeredEngines().map((engine) => engine.id)).toEqual([
      'ninfer',
      'hyperqwen',
      'llamacpp',
      'strata',
    ])
    // Phase 7 registers the built-in presets: the two NInfer measured presets
    // and the three Hyper-Qwen tiers (distinct by label, one isDefault).
    expect(ctx.localInfer.registeredPresets()).toHaveLength(5)
    expect(
      ctx.localInfer
        .registeredPresets()
        .map((preset) => `${preset.engineId}/${preset.modelId}/${preset.hardwareClass}`)
        .sort(),
    ).toEqual([
      'hyperqwen/qwen3-27b/24g-sm86',
      'hyperqwen/qwen3-27b/24g-sm86',
      'hyperqwen/qwen3-27b/24g-sm86',
      'ninfer/qwen3-27b/24g-sm86',
      'ninfer/qwen3-35b/24g-sm86',
    ])
    expect(ctx.localInfer.registeredGuidelines().map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
    ])
    expect(ctx.localInfer.registeredVramModels().map((model) => model.id)).toEqual([
      'qwen3-27b',
      'qwen3-27b-swift15',
      'qwen3-35b',
    ])
  })
})
