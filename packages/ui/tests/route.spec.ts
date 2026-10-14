import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Config,
  EngineAdapter,
  GuidelineResult,
  HardwareProfile,
  InstallResult,
  LaunchPlan,
  SystemDep,
  VramBreakdown,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'
import type { LaunchResult, LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
import {
  buildDeps,
  buildSummary,
  launchEngine,
  localInferConfigPath,
  readConfig,
  registerLocalInferRoute,
  resolveBuildMode,
  RouteError,
  runInstallFor,
  stopEngine,
  writeConfig,
} from '../src/route.ts'
import type { EngineInfo } from '@dsh/dsh-plugin-local-infer/providers'

const HW: HardwareProfile = {
  os: 'linux',
  cpuThreads: 8,
  dockerAvailable: true,
  wsl2: false,
  hostRamGiB: 32,
  gpu: { name: 'RTX 3090', vramGiB: 24, sm: 86 },
  packageManager: 'apt',
}

const BREAKDOWN: VramBreakdown = {
  weights: 1,
  kv: 2,
  overhead: 3,
  workspace: 4,
  free: 100,
  reserve: 10,
  total: 20,
  usable: 30,
  largestFittingContext: 8192,
}

const FITS: VramVerdict = { status: 'fits', detail: 'fits with headroom' }

// A guideline result the banner and the inline map both render from: an
// error anchored to kvDtype, which is the plan's red-warning contract.
const FIRED: GuidelineResult[] = [
  {
    id: 'vram-exceeds-usable',
    level: 'error',
    message: 'the KV cache exceeds the usable VRAM',
    anchors: ['kvDtype'],
  },
]

const TEST_DEP: SystemDep = {
  id: 'cmake',
  purpose: 'compiles the local engine',
  requiresSudo: true,
  install: { apt: { commands: ['sudo apt install cmake'] } },
}

/**
 * A fake engine adapter the launch and stop route tests register: it renders a
 * fixed process plan and reports a healthy launch, so the route's plan render
 * and the service call are the only things under test.
 */
function fakeAdapter(id: string): EngineAdapter {
  return {
    id,
    supports: { docker: true, local: true },
    parameters: () => [],
    renderLaunch: (_config: Config, _hw: HardwareProfile): LaunchPlan => ({
      engineId: id,
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }),
    healthCheck: async () => ({ healthy: true }),
    deploy: async () => ({ ok: true }),
    stop: async () => {
      /* the route test asserts the service stop call, not the adapter */
    },
  } as unknown as EngineAdapter
}

function stubService(
  guidelines: GuidelineResult[],
  extras: {
    deps?: readonly SystemDep[]
    installResult?: InstallResult
    engines?: readonly EngineAdapter[]
    launchResult?: LaunchResult
  } = {},
): LocalInferService {
  return {
    detectHardware: async () => HW,
    estimate: async () => ({ breakdown: BREAKDOWN, verdict: FITS, source: 'measured' }),
    guidelines: async () => guidelines,
    registeredVramModels: () => [],
    registeredEngines: () => (extras.engines ?? [fakeAdapter('ninfer'), fakeAdapter('hyperqwen')]),
    deps: async () => (extras.deps ?? []),
    runInstall: async () =>
      extras.installResult ?? {
        ok: true,
        results: (extras.deps ?? []).map((dep) => ({ id: dep.id, status: 'satisfied' as const })),
      },
    launch: async (plan: LaunchPlan): Promise<LaunchResult> =>
      extras.launchResult ?? { plan, healthy: true },
    stop: async () => {
      /* the route test asserts the call, not the effect */
    },
  } as unknown as LocalInferService
}

describe('local-infer route read model', () => {
  let home: string

  beforeAll(() => {
    // readConfig and writeConfig key the config file on homedir(), so the
    // suite points HOME at a scratch dir and never touches the real one.
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('prices the meter and fires the guideline warnings in one summary', async () => {
    const summary = await buildSummary(stubService(FIRED), { engine: 'ninfer', config: {} })
    expect(summary.engineId).toBe('ninfer')
    expect(summary.verdict).toEqual(FITS)
    expect(summary.meterModel.largestFittingContext).toBe(8192)
    expect(summary.warningsModel.banner.visible).toBe(true)
    expect(summary.warningsModel.banner.level).toBe('error')
    expect(summary.warningsModel.banner.count).toBe(1)
    expect(summary.warningsModel.inline['kvDtype']).toHaveLength(1)
    expect(summary.warningsModel.inline['kvDtype']?.[0]?.tone).toBe('red')
  })

  it('reads the banner as hidden when no guideline fired', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'hyperqwen', config: {} })
    expect(summary.engineId).toBe('hyperqwen')
    expect(summary.warningsModel.banner.visible).toBe(false)
    expect(Object.keys(summary.warningsModel.inline)).toEqual([])
  })

  it('falls back to the first engine when the request names none', async () => {
    const summary = await buildSummary(stubService([]), undefined)
    expect(summary.engineId).toBe('ninfer')
  })

  it('round-trips the stored config through the file the CLI shares', () => {
    const config: Config = { maxContext: 65536 }
    writeConfig('ninfer', config, true)
    expect(localInferConfigPath()).toBe(join(home, '.dsh', 'local-infer', 'config.json'))
    expect(readConfig()).toEqual({ engine: 'ninfer', config, allowRunDeps: true })
  })

  it('reads a missing config file as the scaffold default with the gate off', () => {
    // The round-trip above wrote the file, so clear it for this assertion.
    rmSync(localInferConfigPath())
    expect(readConfig()).toEqual({ engine: 'ninfer', config: {}, allowRunDeps: false })
  })
})

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

  it('honors a supported buildMode from the config', () => {
    expect(resolveBuildMode(ninfer, { buildMode: 'docker' })).toBe('docker')
    expect(resolveBuildMode(ninfer, { buildMode: 'local' })).toBe('local')
  })

  it('falls back to the engine default when the config names none or an unsupported mode', () => {
    expect(resolveBuildMode(ninfer, {})).toBe('local')
    expect(resolveBuildMode(ninfer, { buildMode: 'weird' })).toBe('local')
    // A docker-only engine defaults to docker and rejects a local request.
    expect(resolveBuildMode(hyperqwen, {})).toBe('docker')
    expect(resolveBuildMode(hyperqwen, { buildMode: 'local' })).toBe('docker')
  })
})

describe('deps panel read model', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-deps-'))
    process.env.HOME = home
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

describe('launch and stop route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-launch-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('renders the plan through the registered adapter and returns the launch answer', async () => {
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    const result = await launchEngine(service, { engine: 'ninfer', config: { port: 18020 } })
    expect(result.healthy).toBe(true)
    expect(result.plan.engineId).toBe('ninfer')
  })

  it('renders the plan and calls the service stop entry point with it', async () => {
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, { engine: 'ninfer', config: {} })
    expect(stoppedPlan?.engineId).toBe('ninfer')
    expect(stoppedPlan?.kind).toBe('process')
  })

  it('refuses to launch an engine no adapter serves with a 404', async () => {
    const service = stubService([], { engines: [] })
    await expect(launchEngine(service, { engine: 'strata' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })
})

describe('route handlers over a fake web server', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-http-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  interface FakeRes {
    status: number
    body: string
  }

  function fakeRes(): FakeRes {
    const res = {
      status: 0,
      body: '',
      writeHead(status: number): FakeRes {
        res.status = status
        return res
      },
      end(body?: string): FakeRes {
        res.body = body ?? ''
        return res
      },
    }
    return res
  }

  function fakeReq(method: string, url: string, body?: string) {
    const chunks = body !== undefined ? [Buffer.from(body)] : []
    return {
      method,
      url,
      destroy(): void {
        /* the handlers only destroy on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        for (const chunk of chunks) {
          yield chunk
        }
      },
    }
  }

  function registeredRoutes(service: LocalInferService) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }): () => void {
          routes.push(route)
          return () => {
            /* the effect disposer unregisters; the test owns the list */
          }
        },
      },
      effect(fn: () => unknown): void {
        fn()
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    return routes
  }

  it('serves the deps route and maps the install route through the gate', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const routes = registeredRoutes(stubService([], { deps: [TEST_DEP] }))
    const paths = routes.map((route) => route.path)
    expect(paths).toEqual([
      '/local-infer/summary',
      '/local-infer/save',
      '/local-infer/deps',
      '/local-infer/install',
      '/local-infer/launch',
      '/local-infer/stop',
    ])

    const depsRoute = routes.find((route) => route.path === '/local-infer/deps')
    const depsRes = fakeRes()
    await depsRoute?.handler(fakeReq('GET', '/local-infer/deps?engine=ninfer'), depsRes)
    expect(depsRes.status).toBe(200)
    const depsModel = JSON.parse(depsRes.body)
    expect(depsModel.deps[0]?.id).toBe('cmake')
    expect(depsModel.allSatisfied).toBe(false)
    expect(depsModel.runAllowed).toBe(false)

    // The gate is off, so the install route answers 409 with its message.
    const installRoute = routes.find((route) => route.path === '/local-infer/install')
    const installRes = fakeRes()
    await installRoute?.handler(
      fakeReq('POST', '/local-infer/install', JSON.stringify({ engine: 'ninfer' })),
      installRes,
    )
    expect(installRes.status).toBe(409)
    expect(JSON.parse(installRes.body).error).toContain('not allowed')
  })

  it('runs the install route through to a refreshed deps model when the gate is on', async () => {
    writeConfig('ninfer', {}, true)
    const routes = registeredRoutes(stubService([], { deps: [TEST_DEP] }))
    const installRoute = routes.find((route) => route.path === '/local-infer/install')
    const res = fakeRes()
    await installRoute?.handler(
      fakeReq('POST', '/local-infer/install', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.ok).toBe(true)
    expect(body.deps.allSatisfied).toBe(true)
  })

  it('answers 405 for the wrong method on every route', async () => {
    const routes = registeredRoutes(stubService([]))
    for (const route of routes) {
      const res = fakeRes()
      // Each route takes one method; the wrong one is its complement. The
      // save, install, launch, and stop routes take a POST, so a GET is wrong;
      // the summary and deps routes take a GET, so a POST is wrong.
      if (
        route.path === '/local-infer/save' ||
        route.path === '/local-infer/install' ||
        route.path === '/local-infer/launch' ||
        route.path === '/local-infer/stop'
      ) {
        await route.handler(fakeReq('GET', route.path), res)
      } else {
        await route.handler(fakeReq('POST', route.path, '{}'), res)
      }
      expect(res.status).toBe(405)
    }
  })
})
