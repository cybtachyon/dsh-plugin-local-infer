import { describe, expect, it } from 'vitest'
import type { EngineOsProfile } from '../src/engines/engineOs.ts'
import type { SystemDep } from '../../core/lib/index.js'

// A SystemDep literal the profile's deps array can carry. The install map
// keys one command list per package manager (apt here); detect is optional.
const cudaDep: SystemDep = {
  id: 'cuda-toolkit',
  purpose: 'the CUDA 13 toolkit',
  requiresSudo: true,
  install: {
    apt: { commands: ['sudo apt-get install -y cuda-toolkit-13-0'] },
  },
}

/**
 * Compile-time assertion: an EngineOsProfile literal with a deps array
 * type-checks against the interface, and the field reads back as a
 * readonly SystemDep list at runtime.
 */
const profile: EngineOsProfile = {
  buildSteps: ['cmake -S . -B build -DCMAKE_BUILD_TYPE=Release'],
  buildDir: 'build',
  binary: 'basalt',
  deps: [cudaDep],
}

describe('EngineOsProfile', () => {
  it('accepts a deps array on a profile literal', () => {
    expect(profile.deps).toHaveLength(1)
    expect(profile.deps?.[0]?.id).toBe('cuda-toolkit')
  })

  it('leaves deps absent on a profile without one', () => {
    const noDeps: EngineOsProfile = { buildSteps: [] }
    expect(noDeps.deps).toBeUndefined()
  })
})
