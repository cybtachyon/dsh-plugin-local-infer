import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from '@dsh/dsh-plugin-local-infer-service'
import localInferTool, { apply, inject, name } from '../src/index.ts'

describe('local-infer-tool scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-tool')
    expect(inject).toEqual(['localInfer'])
    expect(localInferTool).toEqual({ name, inject, apply })
  })

  it('loads alongside the service without registering any tool', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferTool)
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
  })
})
