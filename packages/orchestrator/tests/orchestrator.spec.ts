import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import orchestrator, { apply, inject, name } from '../src/index.ts'

describe('local-infer-orchestrator scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-orchestrator')
    expect(inject).toEqual([])
    expect(orchestrator).toEqual({ name, inject, apply })
  })

  it('loads into a bare context with no services present', async () => {
    // The scaffold injects nothing, so a profile without systemPrompt or
    // webServer still mounts the component cleanly.
    const ctx = new Context()
    const fiber = await ctx.plugin(orchestrator)
    expect(fiber).toBeDefined()
  })
})
