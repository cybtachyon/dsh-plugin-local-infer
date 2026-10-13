import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from '@dsh/dsh-plugin-local-infer-service'
import localInferUi, { apply, inject, name } from '../src/index.ts'

describe('local-infer-ui scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-ui')
    expect(inject).toEqual(['localInfer'])
    expect(localInferUi).toEqual({ name, inject, apply })
  })

  it('loads alongside the service without mounting any UI', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferUi)
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
  })
})
