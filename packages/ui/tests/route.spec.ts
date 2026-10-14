import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Config,
  DefaultModel,
  EngineAdapter,
  EnginePlatformConfig,
  GuidelineResult,
  HardwareProfile,
  InstallResult,
  LaunchPlan,
  ModelDirectoryEntry,
  ModelRow,
  ProviderRef,
  ProviderStatus,
  RegisterResult,
  SystemDep,
  VramBreakdown,
  VramModel,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'
import type {
  DownloadResult,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
} from '@dsh/dsh-plugin-local-infer/service'
import {
  buildDeps,
  buildSummary,
  downloadFor,
  launchEngine,
  localInferConfigPath,
  readConfig,
  registerFor,
  registerLocalInferRoute,
  resolveBuildMode,
  resolveContextWindow,
  RouteError,
  runInstallFor,
  stopEngine,
  unregisterFor,
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
 * A fake engine adapter the launch, stop, and register route tests register:
 * it renders a fixed process plan and reports a healthy launch, so the
 * route's plan render and the service call are the only things under test.
 * The optional modelRef stands in for the adapter's model seam, so the
 * register route's model-row resolution is the thing under test.
 */
function fakeAdapter(
  id: string,
  modelRef?: { id: string; name: string },
): EngineAdapter {
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
    modelRef: modelRef === undefined ? undefined : () => modelRef,
  } as unknown as EngineAdapter
}

function stubService(
  guidelines: GuidelineResult[],
  extras: {
    deps?: readonly SystemDep[]
    installResult?: InstallResult
    engines?: readonly EngineAdapter[]
    launchResult?: LaunchResult
    registerResult?: RegisterResult
    onRegister?: (args: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions }) => void
    onRemove?: (args: { providerId: string; modelId: string }) => void
    onPlatform?: (config: EnginePlatformConfig) => void
    models?: readonly VramModel[]
    hfCliPath?: string | null
    onDownload?: (args: { entry: DefaultModel; directory: string }) => void
    downloadResult?: DownloadResult
    modelEntries?: ModelDirectoryEntry[]
    providerStatuses?: (
      providers: readonly ProviderRef[],
    ) => Promise<Record<string, ProviderStatus>>
  } = {},
): LocalInferService {
  return {
    detectHardware: async () => HW,
    estimate: async () => ({
      breakdown: BREAKDOWN,
      verdict: FITS,
      source: 'measured',
      reserveSource: 'default',
    }),
    detectOsReserve: async () => ({ reserveMiB: 3072, source: 'default' }),
    providerStatuses: async (providers: readonly ProviderRef[]) =>
      (await extras.providerStatuses?.(providers)) ?? {},
    launchedEngineIds: () => [],
    guidelines: async () => guidelines,
    registeredVramModels: () => (extras.models ?? []),
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
    registerModel: async (
      plan: LaunchPlan,
      model: ModelRow,
      options?: RegisterModelOptions,
    ): Promise<RegisterResult> => {
      extras.onRegister?.({ plan, model, options })
      return (
        extras.registerResult ?? {
          ok: true,
          entry: {
            providerId: 'ninfer-local',
            modelId: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            baseURL: `http://127.0.0.1:${plan.port}/v1`,
            apiKeyEnv: 'NINFER_LOCAL_API_KEY',
          },
        }
      )
    },
    removeModel: async (providerId: string, modelId: string): Promise<void> => {
      extras.onRemove?.({ providerId, modelId })
    },
    registerEnginePlatformConfig: (config: EnginePlatformConfig): () => void => {
      extras.onPlatform?.(config)
      return () => {
        /* the route test tracks the registration, not the disposer */
      }
    },
    enginePlatformConfig: () => undefined,
    resolveDefaults: async (
      _engineId: string,
      _modelId: string,
      _hw: HardwareProfile,
      explicit?: Config,
    ) => ({
      config: { ...(explicit ?? {}) },
      provenance: [],
    }),
    fetchPreset: async () => ({ preset: undefined, stored: false, degraded: true }),
    defaultModelDirectory: () => MODEL_DIR,
    hfCliAvailable: async () => extras.hfCliPath ?? null,
    downloadModel: async (entry: DefaultModel, directory: string) => {
      extras.onDownload?.({ entry, directory })
      return extras.downloadResult ?? { ok: true }
    },
    listModelDirectory: () => extras.modelEntries ?? [],
  } as unknown as LocalInferService
}

/**
 * The model directory the stub service's defaultModelDirectory names. The
 * presence tests create the artifact file here, so the path is a real
 * directory the suite owns, not a literal.
 */
const MODEL_DIR = mkdtempSync(join(tmpdir(), 'local-infer-models-'))

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
    // The summary carries the resolved defaults model the card draws from.
    expect(summary.defaults).toBeDefined()
    expect(summary.defaults.provenance).toEqual([])
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

  it('rides the estimate reserve source into the meter model', async () => {
    // The meter's reserve readout names where the dark segment came from, so
    // the summary must carry the estimate's reserveSource, not a constant.
    const service: LocalInferService = {
      ...stubService([]),
      estimate: async () => ({
        breakdown: BREAKDOWN,
        verdict: FITS,
        source: 'measured',
        reserveSource: 'foreign-process',
      }),
    }
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.reserveSource).toBe('foreign-process')
    // The stub service's default source rides through when the estimate
    // carries none of the dynamic sources.
    const defaulted = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(defaulted.meterModel.reserveSource).toBe('default')
  })

  it('round-trips the stored config through the file the CLI shares', () => {
    const config: Config = { maxContext: 65536 }
    writeConfig('ninfer', config, true)
    expect(localInferConfigPath()).toBe(join(home, '.dsh', 'local-infer', 'config.json'))
    expect(readConfig()).toEqual({
      engine: 'ninfer',
      config,
      allowRunDeps: true,
      platform: {},
      showHelp: true,
      providers: [],
    })
  })

  it('reads a missing config file as the scaffold default with the gate off', () => {
    // The round-trip above wrote the file, so clear it for this assertion.
    rmSync(localInferConfigPath())
    expect(readConfig()).toEqual({
      engine: 'ninfer',
      config: {},
      allowRunDeps: false,
      platform: {},
      showHelp: true,
      providers: [],
    })
  })

  it('round-trips the help toggle and reads a missing key as visible', () => {
    writeConfig('ninfer', {}, false, undefined, false)
    expect(readConfig().showHelp).toBe(false)
    // A file that predates the key reads as descriptions visible, the
    // default the card draws on first open.
    const path = localInferConfigPath()
    writeFileSync(path, JSON.stringify({ engine: 'ninfer', config: {}, allowRunDeps: false }))
    expect(readConfig().showHelp).toBe(true)
  })

  it('exposes the stored help toggle in the summary', async () => {
    writeConfig('ninfer', {}, false, undefined, false)
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.showHelp).toBe(false)
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

describe('platform config (§3.10) round trip and launch pass-through', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-platform-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('round-trips the per-engine platform config through the file', () => {
    writeConfig('ninfer', {}, false, {
      ninfer: { engineDirectory: '/home/derek/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
    })
    const stored = readConfig()
    expect(stored.platform).toEqual({
      ninfer: {
        engineDirectory: '/home/derek/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
      },
    })
  })

  it('drops a non-object platform map and non-string fields', () => {
    const path = localInferConfigPath()
    // A by-hand edit can leave a malformed platform map; the route reads it
    // as absent rather than poisoning the deploy step.
    writeFileSync(
      path,
      JSON.stringify({
        engine: 'ninfer',
        config: {},
        allowRunDeps: false,
        platform: { ninfer: { engineDirectory: 42, engineFork: 'ok' }, hyperqwen: 'not-an-object' },
      }),
    )
    expect(readConfig().platform).toEqual({
      ninfer: { engineFork: 'ok' },
    })
  })

  it('exposes the stored platform map in the summary', async () => {
    writeConfig('ninfer', {}, false, {
      ninfer: { engineDirectory: '/home/derek/src/ninfer' },
    })
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.platformConfigs).toEqual({
      ninfer: { engineDirectory: '/home/derek/src/ninfer' },
    })
  })

  it('registers the request platform override with the service before launch', async () => {
    let seen: EnginePlatformConfig | undefined
    const service = stubService([], {
      onPlatform: (config: EnginePlatformConfig) => {
        seen = config
      },
    })
    await launchEngine(service, {
      engine: 'ninfer',
      config: { port: 18020 },
      platform: { engineDirectory: '/home/derek/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
    })
    expect(seen).toEqual({
      engineId: 'ninfer',
      engineDirectory: '/home/derek/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
  })

  it('keeps the stored entry when the launch request carries no platform', async () => {
    let registered = false
    const service = stubService([], {
      onPlatform: () => {
        registered = true
      },
    })
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020 } })
    expect(registered).toBe(false)
  })
})

describe('register and unregister route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-register-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('resolves the model row through the adapter seam and passes the options through', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        seen = args
      },
    })
    const result = await registerFor(service, {
      engine: 'ninfer',
      config: { maxContext: 32768 },
      agentDefault: true,
    })
    expect(result.ok).toBe(true)
    expect(seen?.model).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 32768 })
    expect(seen?.options).toEqual({ agentDefault: true })
    expect(seen?.plan.engineId).toBe('ninfer')
  })

  it('falls back to the plan model id when the adapter declares no modelRef', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer')],
      onRegister: (args) => {
        seen = args
      },
    })
    // The fake adapter renders a plan without a modelId and declares no
    // modelRef, so the engine id is the published model id.
    await registerFor(service, { engine: 'ninfer', config: {} })
    expect(seen?.model?.id).toBe('ninfer')
    expect(seen?.model?.name).toBe('ninfer')
    expect(seen?.options).toBeUndefined()
  })

  it('unregisters the provider and model the register step resolved', async () => {
    let seen: { providerId: string; modelId: string } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRemove: (args) => {
        seen = args
      },
    })
    const result = await unregisterFor(service, { engine: 'ninfer', config: {} })
    expect(result).toEqual({ removed: true })
    expect(seen).toEqual({ providerId: 'ninfer-local', modelId: 'Qwen3.8-27B' })
  })

  it('refuses to register an engine no adapter serves with a 404', async () => {
    const service = stubService([], { engines: [] })
    await expect(registerFor(service, { engine: 'strata' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })
})

describe('resolveContextWindow', () => {
  const MODELS: VramModel[] = [
    {
      id: 'qwen3-27b',
      source: 'measured',
      weightsBytes: 1,
      workspaceBytes: 1,
      nativeMaxContext: 262144,
      seqFixedBytes: 1,
      seqPerToken: 1,
      kvBytesPerToken: { int8: 1 },
    },
  ]

  it('honors a configured maxContext', () => {
    expect(resolveContextWindow({ maxContext: 131072 }, MODELS)).toBe(131072)
    // A non-positive or non-number value falls through to the model ceiling.
    expect(resolveContextWindow({ maxContext: 0 }, MODELS)).toBe(262144)
    expect(resolveContextWindow({ maxContext: '131072' }, MODELS)).toBe(262144)
  })

  it('reads the named model ceiling when the config names a model', () => {
    expect(resolveContextWindow({ model: 'qwen3-27b' }, MODELS)).toBe(262144)
    // A model no provider registered reads the spec default.
    expect(resolveContextWindow({ model: 'qwen3-99b' }, MODELS)).toBe(32768)
  })

  it('reads the single registered model ceiling when the config names none', () => {
    expect(resolveContextWindow({}, MODELS)).toBe(262144)
  })

  it('reads the spec default when no model resolves', () => {
    expect(resolveContextWindow({ model: 'qwen3-99b' }, [])).toBe(32768)
    expect(resolveContextWindow({}, [])).toBe(32768)
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
      '/local-infer/provider-delete',
      '/local-infer/deps',
      '/local-infer/install',
      '/local-infer/download',
      '/local-infer/launch',
      '/local-infer/stop',
      '/local-infer/register',
      '/local-infer/unregister',
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

  it('serves the register and unregister routes through to the service', async () => {
    let removed: { providerId: string; modelId: string } | undefined
    const service = stubService(
      [],
      {
        engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
        onRemove: (args) => {
          removed = args
        },
      },
    )
    const routes = registeredRoutes(service)

    const registerRoute = routes.find((route) => route.path === '/local-infer/register')
    const registerRes = fakeRes()
    await registerRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/register',
        JSON.stringify({ engine: 'ninfer', config: { maxContext: 32768 }, agentDefault: true }),
      ),
      registerRes,
    )
    expect(registerRes.status).toBe(200)
    const registerBody = JSON.parse(registerRes.body)
    expect(registerBody.ok).toBe(true)
    expect(registerBody.entry.modelId).toBe('Qwen3.8-27B')
    expect(registerBody.entry.baseURL).toBe('http://127.0.0.1:18020/v1')

    const unregisterRoute = routes.find((route) => route.path === '/local-infer/unregister')
    const unregisterRes = fakeRes()
    await unregisterRoute?.handler(
      fakeReq('POST', '/local-infer/unregister', JSON.stringify({ engine: 'ninfer' })),
      unregisterRes,
    )
    expect(unregisterRes.status).toBe(200)
    expect(JSON.parse(unregisterRes.body)).toEqual({ removed: true })
    expect(removed).toEqual({ providerId: 'ninfer-local', modelId: 'Qwen3.8-27B' })
  })

  it('answers 405 for the wrong method on every route', async () => {
    const routes = registeredRoutes(stubService([]))
    for (const route of routes) {
      const res = fakeRes()
      // Each route takes one method; the wrong one is its complement. The
      // save, provider-delete, install, launch, stop, register, and
      // unregister routes take a POST, so a GET is wrong; the summary and
      // deps routes take a GET, so a POST is wrong.
      if (
        route.path === '/local-infer/save' ||
        route.path === '/local-infer/provider-delete' ||
        route.path === '/local-infer/install' ||
        route.path === '/local-infer/download' ||
        route.path === '/local-infer/launch' ||
        route.path === '/local-infer/stop' ||
        route.path === '/local-infer/register' ||
        route.path === '/local-infer/unregister'
      ) {
        await route.handler(fakeReq('GET', route.path), res)
      } else {
        await route.handler(fakeReq('POST', route.path, '{}'), res)
      }
      expect(res.status).toBe(405)
    }
  })
})

describe('route handler error branches', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-err-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function fakeRes() {
    const res = {
      status: 0,
      body: '',
      writeHead(status: number): typeof res {
        res.status = status
        return res
      },
      end(body?: string): typeof res {
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

  function routes(service: LocalInferService) {
    const list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    registerLocalInferRoute(
      {
        webServer: {
          register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
            list.push(route)
            return () => {
              /* the test owns the list */
            }
          },
        },
        effect(fn: () => unknown): void {
          fn()
        },
      } as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    return list
  }

  const find = (list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[], path: string) =>
    list.find((route) => route.path === path)!

  it('answers 413 when a save payload exceeds the 64 KiB cap', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const big = JSON.stringify({ engine: 'ninfer', config: { pad: 'x'.repeat(65 * 1024) } })
    const res = fakeRes()
    await save.handler(fakeReq('POST', '/local-infer/save', big), res)
    expect(res.status).toBe(413)
    expect(JSON.parse(res.body).error).toContain('too large')
  })

  it('answers 400 when a save body is not valid JSON', async () => {
    // A broken save body is a client error, so the save route answers 400
    // where the other POST routes answer 500.
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(fakeReq('POST', '/local-infer/save', '{not json'), res)
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toBeDefined()
  })

  it('persists the help toggle through the save route', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: false }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    // The stored file carries the toggle, and a body that omits it keeps
    // the descriptions visible.
    expect(readConfig().showHelp).toBe(false)
    const again = fakeRes()
    await save.handler(
      fakeReq('POST', '/local-infer/save', JSON.stringify({ engine: 'ninfer', config: {} })),
      again,
    )
    expect(again.status).toBe(200)
    expect(readConfig().showHelp).toBe(true)
  })

  it('reads the summary config query param, falling back on a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const summary = find(list, '/local-infer/summary')
    // A valid config param round-trips into the summary.
    const good = fakeRes()
    await summary.handler(
      fakeReq('GET', '/local-infer/summary?engine=ninfer&config=' + encodeURIComponent(JSON.stringify({ maxContext: 4096 }))),
      good,
    )
    expect(good.status).toBe(200)
    // A broken config param reads as absent, so the summary still answers.
    const broken = fakeRes()
    await summary.handler(
      fakeReq('GET', '/local-infer/summary?engine=ninfer&config={broken'),
      broken,
    )
    expect(broken.status).toBe(200)
  })

  it('reads the deps config query param the same way', async () => {
    const service = stubService([], { deps: [TEST_DEP] })
    const list = routes(service)
    const deps = find(list, '/local-infer/deps')
    const res = fakeRes()
    await deps.handler(
      fakeReq('GET', '/local-infer/deps?engine=ninfer&config=' + encodeURIComponent(JSON.stringify({ maxContext: 4096 }))),
      res,
    )
    expect(res.status).toBe(200)
  })

  it('answers 413 for an oversize register payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const register = find(list, '/local-infer/register')
    const bigRes = fakeRes()
    await register.handler(
      fakeReq('POST', '/local-infer/register', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await register.handler(fakeReq('POST', '/local-infer/register', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('answers 413 for an oversize launch payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const launch = find(list, '/local-infer/launch')
    const bigRes = fakeRes()
    await launch.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await launch.handler(fakeReq('POST', '/local-infer/launch', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('answers 413 for an oversize stop payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const stop = find(list, '/local-infer/stop')
    const bigRes = fakeRes()
    await stop.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await stop.handler(fakeReq('POST', '/local-infer/stop', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('serves the download route and maps the service answer through', async () => {
    let seen: { entry: DefaultModel; directory: string } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    const list = routes(service)
    const download = find(list, '/local-infer/download')
    const res = fakeRes()
    await download.handler(
      fakeReq(
        'POST',
        '/local-infer/download',
        JSON.stringify({ engine: 'ninfer', model: 'qwen3-27b', directory: '/custom/models' }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(seen?.entry?.modelId).toBe('qwen3-27b')
    expect(seen?.directory).toBe('/custom/models')
  })

  it('answers 404 for a download the default list does not name', async () => {
    const list = routes(stubService([]))
    const download = find(list, '/local-infer/download')
    const res = fakeRes()
    await download.handler(
      fakeReq('POST', '/local-infer/download', JSON.stringify({ engine: 'strata' })),
      res,
    )
    expect(res.status).toBe(404)
    expect(JSON.parse(res.body).error).toContain('no default model')
  })
})

describe('model defaults, status, and download read model', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-models-route-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(MODEL_DIR, { recursive: true, force: true })
  })

  it('seeds the summary with the model directory and the engine default models', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.modelDirectory).toBe(MODEL_DIR)
    expect(summary.modelDefaults).toEqual([
      {
        id: 'qwen3-27b',
        label: 'Ninfer Qwen3.8-27B',
        url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      },
      {
        id: 'qwen36-35b',
        label: 'Ninfer Qwen3.6-35B',
        url: 'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      },
    ])
    // An engine with no defaults (Strata) carries an empty list and a null
    // status, so the card renders no Model row for it.
    const strata = await buildSummary(stubService([]), { engine: 'strata', config: {} })
    expect(strata.modelDefaults).toEqual([])
    expect(strata.modelStatus).toBeNull()
  })

  it('applies the default directory to the config when the user named none', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.config.modelDirectory).toBe(MODEL_DIR)
  })

  it('keeps a user-named directory over the default', async () => {
    const summary = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { modelDirectory: '/custom/models' },
    })
    expect(summary.config.modelDirectory).toBe('/custom/models')
    expect(summary.modelStatus?.downloadCommand).toContain('--local-dir /custom/models')
  })

  it('reads an absent model as the no-CLI row with the download command', async () => {
    const summary = await buildSummary(stubService([], { hfCliPath: null }), {
      engine: 'ninfer',
      config: {},
    })
    expect(summary.modelStatus).toEqual({
      modelId: 'qwen3-27b',
      label: 'Ninfer Qwen3.8-27B',
      url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      present: false,
      hfCli: false,
      downloadCommand: `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir ${MODEL_DIR}`,
    })
  })

  it('reports the hf CLI detected when the probe finds it', async () => {
    const summary = await buildSummary(stubService([], { hfCliPath: '/usr/local/bin/hf' }), {
      engine: 'ninfer',
      config: {},
    })
    expect(summary.modelStatus?.hfCli).toBe(true)
  })

  it('reads the model as present when its artifact file is in the directory', async () => {
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'weights')
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.modelStatus?.present).toBe(true)
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'))
  })

  it('resolves the download through the service with the request directory', async () => {
    let seen: { entry: DefaultModel; directory: string } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    const result = await downloadFor(service, {
      engine: 'ninfer',
      model: 'qwen36-35b',
      directory: '/custom/models',
    })
    expect(result).toEqual({ ok: true })
    expect(seen?.entry?.url).toBe('https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer')
    expect(seen?.directory).toBe('/custom/models')
  })

  it('falls back to the stored config directory and model when the request names none', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: '/stored/models' }, false)
    let seen: { entry: DefaultModel; directory: string } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    await downloadFor(service, {})
    expect(seen?.entry?.modelId).toBe('qwen3-27b')
    expect(seen?.directory).toBe('/stored/models')
  })

  it('refuses a download for a model no default names with a 404', async () => {
    await expect(downloadFor(stubService([]), { engine: 'strata', model: 'qwen3-27b' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })

  it('seeds the summary with the directory-scanned model files for the engine', async () => {
    const service = stubService([], {
      modelEntries: [
        { name: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer', isDirectory: false },
        { name: 'Qwen3.8-27B-Q4_K_M.gguf', isDirectory: false },
        { name: 'Qwen3.8-27B-W4A16-AutoRound-fast', isDirectory: true, hasSafetensors: true },
        { name: 'froggeric_Qwen-Fixed-Chat-Templates', isDirectory: true, hasSafetensors: false },
      ],
    })
    const ninfer = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(ninfer.modelFiles).toEqual([
      'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    ])
    const llamacpp = await buildSummary(service, { engine: 'llamacpp', config: {} })
    expect(llamacpp.modelFiles).toEqual(['Qwen3.8-27B-Q4_K_M.gguf'])
    const hyperqwen = await buildSummary(service, { engine: 'hyperqwen', config: {} })
    expect(hyperqwen.modelFiles).toEqual(['Qwen3.8-27B-W4A16-AutoRound-fast'])
    // Strata offers no dense-Qwen model, so the scan reads as empty.
    const strata = await buildSummary(service, { engine: 'strata', config: {} })
    expect(strata.modelFiles).toEqual([])
  })
})

describe('provider list round trip', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-prov-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function fakeRes() {
    const res = {
      status: 0,
      body: '',
      writeHead(status: number): typeof res {
        res.status = status
        return res
      },
      end(body?: string): typeof res {
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

  function routes(service: LocalInferService) {
    const list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    registerLocalInferRoute(
      {
        webServer: {
          register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
            list.push(route)
            return () => {
              /* the test owns the list */
            }
          },
        },
        effect(fn: () => unknown): void {
          fn()
        },
      } as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    return list
  }

  const find = (
    list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[],
    path: string,
  ) => list.find((route) => route.path === path)!

  it('lists the saved providers with their statuses in the summary', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
        { id: 'p2', engine: 'hyperqwen', config: { model: 'qwen3-35b' }, platform: {} },
      ],
    )
    const service = stubService([], {
      providerStatuses: async (providers) => {
        const statuses: Record<string, ProviderStatus> = {}
        for (const provider of providers) {
          statuses[provider.id] = provider.id === 'p1' ? 'running' : 'unsure'
        }
        return statuses
      },
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.providers).toEqual([
      {
        id: 'p1',
        engine: 'ninfer',
        model: 'qwen3-27b',
        status: 'running',
        config: { model: 'qwen3-27b' },
        platform: {},
      },
      {
        id: 'p2',
        engine: 'hyperqwen',
        model: 'qwen3-35b',
        status: 'unsure',
        config: { model: 'qwen3-35b' },
        platform: {},
      },
    ])
  })

  it('adds a new provider entry at the top of the list on a save without an id', async () => {
    // Clear the file the earlier test wrote, so a fresh save starts from an
    // empty list and the new entry is the only one.
    rmSync(localInferConfigPath(), { force: true })
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq('POST', '/local-infer/save', JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b' } })),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.engine).toBe('ninfer')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-27b' })
    // The minted id is a non-blank string the card can edit and delete against.
    expect(typeof stored.providers[0]?.id).toBe('string')
    expect(stored.providers[0]?.id.trim()).not.toBe('')
  })

  it('updates a stored provider in place when a save carries its id', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ id: 'p1', engine: 'ninfer', config: { model: 'qwen3-35b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
  })

  it('removes a provider by id through the delete route', async () => {
    const service = stubService([])
    const list = routes(service)
    const del = find(list, '/local-infer/provider-delete')
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
      { id: 'p2', engine: 'hyperqwen', config: { model: 'qwen3-35b' }, platform: {} },
    ])
    const res = fakeRes()
    await del.handler(fakeReq('POST', '/local-infer/provider-delete', JSON.stringify({ id: 'p1' })), res)
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p2')
  })

  it('answers 400 when the delete route is given no id', async () => {
    const service = stubService([])
    const list = routes(service)
    const del = find(list, '/local-infer/provider-delete')
    const res = fakeRes()
    await del.handler(fakeReq('POST', '/local-infer/provider-delete', JSON.stringify({})), res)
    expect(res.status).toBe(400)
  })
})
