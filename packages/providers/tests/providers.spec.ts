import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from '@dsh/dsh-plugin-local-infer/service'
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
    // The providers row registers the NInfer and Hyper-Qwen engine adapters.
    expect(ctx.localInfer.registeredEngines().map((engine) => engine.id)).toEqual([
      'ninfer',
      'hyperqwen',
    ])
    expect(ctx.localInfer.registeredPresets()).toEqual([])
    expect(ctx.localInfer.registeredGuidelines().map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
    ])
    expect(ctx.localInfer.registeredVramModels().map((model) => model.id)).toEqual([
      'qwen3-27b',
      'qwen3-35b',
    ])
  })
})
