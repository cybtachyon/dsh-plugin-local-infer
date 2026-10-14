import { describe, expect, it } from 'vitest'
import type { DepCheck, SystemDep } from '@dsh/dsh-plugin-local-infer/core'
import { renderDeps } from '../src/deps.ts'

function dep(id: string, overrides: Partial<SystemDep> = {}): SystemDep {
  return {
    id,
    purpose: `the ${id} purpose`,
    requiresSudo: true,
    install: {},
    ...overrides,
  }
}

function check(dep: SystemDep, status: DepCheck['status']): DepCheck {
  return { dep, status }
}

describe('renderDeps', () => {
  const input = {
    engineId: 'ninfer',
    buildMode: 'local' as const,
    packageManager: 'apt' as string | null,
    installString: '# System dependencies on linux',
    runAllowed: false,
  }

  it('maps the check results to the panel rows and keeps the gate closed while a dep is missing', () => {
    const model = renderDeps({
      ...input,
      checks: [check(dep('cmake'), 'satisfied'), check(dep('cuda-toolkit'), 'missing')],
    })
    expect(model.deps).toEqual([
      { id: 'cmake', purpose: 'the cmake purpose', status: 'satisfied', requiresSudo: true },
      { id: 'cuda-toolkit', purpose: 'the cuda-toolkit purpose', status: 'missing', requiresSudo: true },
    ])
    expect(model.allSatisfied).toBe(false)
    expect(model.runAllowed).toBe(false)
    expect(model.packageManager).toBe('apt')
  })

  it('opens the "Get" gate only when every dep reports satisfied', () => {
    const model = renderDeps({
      ...input,
      checks: [check(dep('cmake'), 'satisfied'), check(dep('ninja'), 'satisfied')],
    })
    expect(model.allSatisfied).toBe(true)
  })

  it('opens the gate for an empty plan, because there is nothing left to install', () => {
    const model = renderDeps({ ...input, checks: [] })
    expect(model.allSatisfied).toBe(true)
    expect(model.deps).toEqual([])
  })

  it('carries the Play/Run trust gate and a null package manager through', () => {
    const model = renderDeps({
      engineId: 'hyperqwen',
      buildMode: 'docker',
      packageManager: null,
      checks: [check(dep('docker'), 'failed')],
      installString: '',
      runAllowed: true,
    })
    expect(model.runAllowed).toBe(true)
    expect(model.packageManager).toBeNull()
    expect(model.deps[0]?.status).toBe('failed')
    expect(model.allSatisfied).toBe(false)
  })
})
