import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from '@dsh/dsh-plugin-local-infer-service'
import localInferProviders, { apply, inject, name } from '../src/index.ts'

describe('local-infer-providers scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-providers')
    expect(inject).toEqual(['localInfer'])
    expect(localInferProviders).toEqual({ name, inject, apply })
  })

  it('loads alongside the service and keeps the seam empty', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferProviders)
    expect(ctx.localInfer.registeredEngines()).toEqual([])
    expect(ctx.localInfer.registeredPresets()).toEqual([])
    expect(ctx.localInfer.registeredGuidelines()).toEqual([])
  })
})
