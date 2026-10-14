import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from '@dsh/dsh-plugin-local-infer/service'
import localInferProviders from '@dsh/dsh-plugin-local-infer/providers'
import localInferTool from '@dsh/dsh-plugin-local-infer/tool'
import localInferUi from '@dsh/dsh-plugin-local-infer/ui'

/**
 * The Phase 0 exit criterion: the empty plugin bundle loads into a DSH profile
 * (a fresh Cordis Context) with no errors. Mounting all four rows of
 * cordis.patch.yml together proves the layer is coherent and the seam is
 * available to every consumer.
 */
describe('local-infer bundle', () => {
  it('loads all four plugin rows into one Context without error', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferProviders)
    await ctx.plugin(localInferTool)
    await ctx.plugin(localInferUi)
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
    // The providers row registers the NInfer and Hyper-Qwen engine adapters.
    expect(ctx.localInfer.registeredEngines().map((engine) => engine.id)).toEqual([
      'ninfer',
      'hyperqwen',
    ])
    expect(ctx.localInfer.registeredPresets()).toEqual([])
    // The providers row registers the built-in hardware guidelines.
    expect(ctx.localInfer.registeredGuidelines().map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
    ])
  })
})
