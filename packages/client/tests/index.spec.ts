import { describe, expect, it } from 'vitest'
import { apply, inject } from 'dsh-plugin-local-infer/client'

describe('client skeleton', () => {
  it('exports the lazy-CJS entry points', () => {
    expect(typeof apply).toBe('function')
    expect(inject).toEqual([])
  })
})
