import { describe, expect, it } from 'vitest'
import type { DepCheck, SystemDep } from 'dsh-plugin-local-infer/core'
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

  it('carries the chat-template row through while a selected template is missing', () => {
    const model = renderDeps({
      ...input,
      checks: [],
      chatTemplate: {
        repo: 'froggeric/Qwen-Fixed-Chat-Templates',
        present: false,
        hfCli: false,
        downloadCommand:
          'hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir /models',
      },
    })
    expect(model.chatTemplate).toEqual({
      repo: 'froggeric/Qwen-Fixed-Chat-Templates',
      present: false,
      hfCli: false,
      downloadCommand:
        'hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir /models',
    })
  })

  it('leaves the chat-template key off when no template is missing', () => {
    const model = renderDeps({ ...input, checks: [] })
    expect('chatTemplate' in model).toBe(false)
  })
})

/**
 * The deps panel read model (buildDeps, resolveBuildMode) and the install
 * run helper over the stub service. (Split from route.spec.ts by describe,
 * TASK-012; the renderDeps cases above this point are the original file.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import type { EngineInfo } from 'dsh-plugin-local-infer/providers'
import { writeConfig } from '../src/config.ts'
import { RouteError } from '../src/route.ts'
import { buildDeps, resolveBuildMode } from '../src/viewmodels/deps.ts'
import { runInstallFor } from '../src/viewmodels/depsHelpers.ts'
import { MODEL_DIR, TEST_DEP, pointHomeAt, stubService } from './fixtures.ts'

describe('resolveBuildMode', () => {
  const ninfer: EngineInfo = {
    id: 'ninfer',
    label: 'NInfer',
    supports: { docker: true, local: true },
    parameters: [],
  }
  const hyperqwen: EngineInfo = {
    id: 'hyperqwen',
    label: 'Hyper-Qwen',
    supports: { docker: true, local: false },
    parameters: [],
  }
  const strata: EngineInfo = {
    id: 'strata',
    label: 'Strata',
    supports: { docker: true, local: true, binary: true },
    parameters: [],
  }

  it('honors a supported buildMode from the config', () => {
    expect(resolveBuildMode(ninfer, { buildMode: 'docker' })).toBe('docker')
    expect(resolveBuildMode(ninfer, { buildMode: 'local' })).toBe('local')
    expect(resolveBuildMode(strata, { buildMode: 'binary' })).toBe('binary')
    expect(resolveBuildMode(strata, { buildMode: 'docker' })).toBe('docker')
  })

  it('falls back to the engine default when the config names none or an unsupported mode', () => {
    expect(resolveBuildMode(ninfer, {})).toBe('local')
    expect(resolveBuildMode(ninfer, { buildMode: 'weird' })).toBe('local')
    // A docker-only engine defaults to docker and rejects a local request.
    expect(resolveBuildMode(hyperqwen, {})).toBe('docker')
    expect(resolveBuildMode(hyperqwen, { buildMode: 'local' })).toBe('docker')
    // The binary-install engine defaults to the one-line binary path.
    expect(resolveBuildMode(strata, {})).toBe('binary')
    expect(resolveBuildMode(strata, { buildMode: 'weird' })).toBe('binary')
  })
})

describe('deps panel read model', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-deps-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('prices the dep plan, the statuses, the install string, and the stored trust gate', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const model = await buildDeps(
      stubService([], { deps: [TEST_DEP] }),
      { engine: 'ninfer', config: { buildMode: 'local' } },
    )
    expect(model.engineId).toBe('ninfer')
    expect(model.buildMode).toBe('local')
    expect(model.deps).toEqual([
      { id: 'cmake', purpose: 'compiles the local engine', status: 'missing', requiresSudo: true },
    ])
    expect(model.allSatisfied).toBe(false)
    expect(model.runAllowed).toBe(false)
    expect(model.installString).toContain('sudo apt install cmake')
    expect(model.packageManager).toBe('apt')
  })

  it('reads a satisfied plan as the "Get" gate open', async () => {
    writeConfig('ninfer', {}, true)
    const satisfied: SystemDep = {
      ...TEST_DEP,
      detect: async () => true,
    }
    const model = await buildDeps(stubService([], { deps: [satisfied] }), { engine: 'ninfer' })
    expect(model.allSatisfied).toBe(true)
    expect(model.runAllowed).toBe(true)
  })

  it('renders the chat-template row from the raw config model directory', async () => {
    // A directory override keeps the flat --local-dir target for the missing
    // template's download command.
    const overridden = await buildDeps(stubService([], { hfCliPath: '/usr/bin/hf' }), {
      engine: 'ninfer',
      config: { modelDirectory: MODEL_DIR, chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
    })
    expect(overridden.chatTemplate).toEqual({
      repo: 'froggeric/Qwen-Fixed-Chat-Templates',
      present: false,
      hfCli: true,
      downloadCommand: `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir ${MODEL_DIR} --format human`,
    })
    // No override means the hub-cache layout: the command carries no
    // --local-dir and the presence check joins onto the hub cache root.
    const defaulted = await buildDeps(stubService([], { hfCliPath: '/usr/bin/hf' }), {
      engine: 'ninfer',
      config: { chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
    })
    expect(defaulted.chatTemplate?.downloadCommand).toBe(
      'hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --format human',
    )
  })

  it('refuses the Play/Run path with a 409 while the trust gate is off', async () => {
    writeConfig('ninfer', {}, false)
    await expect(runInstallFor(stubService([]), { engine: 'ninfer' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 409 }),
    )
  })

  it('runs the install and refreshes the gate from the re-check when the gate is on', async () => {
    writeConfig('ninfer', {}, true)
    const response = await runInstallFor(stubService([], { deps: [TEST_DEP] }), { engine: 'ninfer' })
    expect(response.result.ok).toBe(true)
    expect(response.deps.allSatisfied).toBe(true)
    expect(response.deps.deps[0]?.status).toBe('satisfied')
  })
})
