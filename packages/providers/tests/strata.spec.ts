import { describe, expect, it } from 'vitest'
import { STRATA_PARAMETERS } from '../src/strata.ts'

describe('Strata parameter surface', () => {
  it('ships an empty surface until the engine flag set lands', () => {
    expect(STRATA_PARAMETERS).toEqual([])
  })
})
