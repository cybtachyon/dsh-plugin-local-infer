import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  Config,
  DefaultModel,
  EngineAdapter,
  EnginePlatformConfig,
  GuidelineResult,
  HardwareProfile,
  InstallResult,
  LaunchPlan,
  LifecycleHost,
  ModelDirectoryEntry,
  ModelRow,
  ProviderLaunchRecord,
  ProviderRef,
  ProviderStatus,
  ReLinkOutcome,
  RegisterResult,
  SystemDep,
  VramBreakdown,
  VramModel,
  VramVerdict,
} from 'dsh-plugin-local-infer/core'
import { DEFAULT_LOG_PATH_TEMPLATE, SUDO_CLI_NOTE, dshEngineCacheDirectory, providerIdFor, resolveLogPath } from 'dsh-plugin-local-infer/core'
import { LocalInfer, RunLogStore } from 'dsh-plugin-local-infer/service'
import type {
  DownloadModelOptions,
  DownloadResult,
  EngineDeathEvent,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
  RunLogListener,
} from 'dsh-plugin-local-infer/service'
import { apply as applyProviders } from 'dsh-plugin-local-infer/providers'
import { localInferConfigPath, readConfig, writeConfig } from '../src/config.ts'
import {
  CANCELED_LINE,
  getEngine,
  handleEngineDeath,
  launchEngine,
  stopEngine,
} from '../src/ops/engine.ts'
import {
  DOWNLOAD_RUN_SEED,
  GET_RUN_SEED,
  INSTALL_RUN_SEED,
  LAUNCH_RUN_SEED,
  STOP_RUN_SEED,
} from '../src/ops/logs.ts'
import { runGetSteps } from '../src/ops/get-steps.ts'
import { downloadFor } from '../src/ops/hf.ts'
import { registerFor, resolveContextWindow, unregisterFor } from '../src/ops/model.ts'
import { registerLocalInferRoute, RouteError } from '../src/route.ts'
import { EXPECTED_ROUTE_PATHS, wrongMethodFor } from './route-paths.ts'
import { buildDeps, resolveBuildMode } from '../src/viewmodels/deps.ts'
import { runInstallFor } from '../src/viewmodels/depsHelpers.ts'
import { buildSummary } from '../src/viewmodels/summary.ts'
import type { EngineInfo } from 'dsh-plugin-local-infer/providers'
import type { StoredProviderConfig } from '../src/config.ts'

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

/**
 * argvAdapter stands in for an engine whose plan carries the child-process
 * argv, so the launch route's command-line note has a command to print.
 */
function argvAdapter(id: string, argv: string[]): EngineAdapter {
  return {
    ...fakeAdapter(id),
    renderLaunch: (): LaunchPlan => ({
      engineId: id,
      kind: 'process',
      argv,
      port: 18080,
      healthUrl: 'http://127.0.0.1:18080/health',
    }),
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
    onDownload?: (args: {
      entry: DefaultModel
      directory: string
      useHubCache: boolean
    }) => void
    downloadResult?: DownloadResult
    onDownloadChatTemplate?: (args: {
      repo: string
      directory: string
      useHubCache: boolean
    }) => void
    chatTemplateDownloadResult?: DownloadResult
    modelIsRegisteredResult?: boolean
    modelEntries?: ModelDirectoryEntry[]
    providerStatuses?: (
      providers: readonly ProviderRef[],
    ) => Promise<Record<string, ProviderStatus>>
    reLinkProviders?: (
      entries: readonly { id: string; record: ProviderLaunchRecord }[],
    ) => Promise<Record<string, ReLinkOutcome>>
    onSetDeathObserver?: (
      observer: ((event: EngineDeathEvent) => void) | undefined,
    ) => void
    onSudoObservers?: (
      hooks: ReadonlyArray<{ key: string; observer: (command: string) => void }>,
    ) => void
  } = {},
): LocalInferService {
  // The sudo seam: the stub keeps one hook per run key, exactly like the
  // real service's registry (registering a key takes its slot, the disposer
  // clears only its own hook, notifySudoNeeded fans out), and reports the
  // live hook list after every change, so a test can watch a run register
  // and clear its hook end to end.
  const sudoObservers = new Map<string, (command: string) => void>()
  const reportSudoObservers = (): void => {
    extras.onSudoObservers?.(
      [...sudoObservers.entries()].map(([key, observer]) => ({ key, observer })),
    )
  }
  // The run-log seam: the stub keeps one real RunLogStore (the service
  // package's own hub) so the launch, get, download, install, and stop paths
  // write live buffers the tests read back through readRunLog.
  const runLogs = new RunLogStore()
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
    unsureBannerKillCommands: async () => [],
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
    reLinkProviders: async (entries) =>
      (await extras.reLinkProviders?.(entries)) ??
      Object.fromEntries(entries.map((entry) => [entry.id, 'adopted' as ReLinkOutcome])),
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
            apiKey: '{{NINFER}}_LOCAL_API_KEY',
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
    downloadModel: async (entry: DefaultModel, directory: string, options?: DownloadModelOptions) => {
      extras.onDownload?.({ entry, directory, useHubCache: options?.useHubCache === true })
      return extras.downloadResult ?? { ok: true }
    },
    downloadChatTemplate: async (
      repo: string,
      directory: string,
      options?: DownloadModelOptions,
    ) => {
      extras.onDownloadChatTemplate?.({
        repo,
        directory,
        useHubCache: options?.useHubCache === true,
      })
      return extras.chatTemplateDownloadResult ?? { ok: true }
    },
    modelIsRegistered: async () => extras.modelIsRegisteredResult ?? false,
    listModelDirectory: () => extras.modelEntries ?? [],
    setEngineDeathObserver: (
      observer: ((event: EngineDeathEvent) => void) | undefined,
    ): void => {
      extras.onSetDeathObserver?.(observer)
    },
    // The sudo seam: registerSudoObserver takes the key's slot and returns
    // the disposer that clears only that hook; notifySudoNeeded fans the
    // guarded command out to every live hook, the way the real service
    // announces a waiting password prompt to every run in flight.
    registerSudoObserver: (key: string, observer: (command: string) => void): (() => void) => {
      sudoObservers.set(key, observer)
      reportSudoObservers()
      return () => {
        if (sudoObservers.get(key) === observer) {
          sudoObservers.delete(key)
          reportSudoObservers()
        }
      }
    },
    notifySudoNeeded: (command: string): void => {
      for (const observer of [...sudoObservers.values()]) {
        observer(command)
      }
    },
    // The run-log seam: the hub operations the route run paths bracket with
    // (beginRun, appendRunLog, readRunLog, subscribeRunLog, endRun), on the
    // real store so assertions read the same buffers the routes write.
    beginRun: (key: string, seed: string): void => {
      runLogs.begin(key, seed)
    },
    appendRunLog: (key: string, text: string): void => {
      runLogs.append(key, text)
    },
    readRunLog: (key: string) => runLogs.read(key),
    subscribeRunLog: (key: string, listener: RunLogListener): (() => void) =>
      runLogs.subscribe(key, listener),
    endRun: (key: string): void => {
      runLogs.end(key)
    },
    // The registration seam no route touches: the literal carries no-op
    // registrations and empty reads so the whole stub is one shape with the
    // interface and type-checks without a cast. Widening LocalInferService
    // then fails this literal's type check until the stub catches up,
    // instead of surfacing at runtime in a route (the old `as unknown as`
    // cast hid exactly that; this spec is not in a tsc project today, so
    // the check lives in the editor until the tests gain a type-check gate).
    registerEngine: () => () => {},
    registerPreset: () => () => {},
    registerGuideline: () => () => {},
    registerVramModel: () => () => {},
    registerDepPlan: () => () => {},
    registeredPresets: () => [],
    registeredGuidelines: () => [],
    registeredDepPlans: () => new Map(),
    installString: async () => '',
    defaultDatasetDirectory: () => MODEL_DIR,
    listModelCache: () => [],
  }
}

/**
 * The model directory the stub service's defaultModelDirectory names. The
 * presence tests create the artifact file here, so the path is a real
 * directory the suite owns, not a literal.
 */
const MODEL_DIR = mkdtempSync(join(tmpdir(), 'local-infer-models-'))

/**
 * pointHomeAt points os.homedir() at a scratch dir so the config, log, and
 * preset file paths never touch the real home. homedir() reads HOME on POSIX
 * and USERPROFILE on Windows, so both are set and the suite stays portable.
 */
function pointHomeAt(dir: string): void {
  process.env.HOME = dir
  process.env.USERPROFILE = dir
}

/**
 * A stub LifecycleHost for the Get steps: `exists` decides whether the
 * `git -C <dir> rev-parse --is-inside-work-tree` probe finds a checkout,
 * `stream` feeds the streamed stdout, and `fail` lists command substrings
 * whose run fails (the sync and build steps stream through `runStream`, so
 * a failed rebase or clone is a `runStream` failure). The launch route tests
 * inject it too, so a launch's Get steps never clone a real repo in CI.
 * The optional `announceSudo` plays the guarded node host's rule: a command
 * containing `sudo` is announced through the hook before it runs, the way
 * `createNodeLifecycleHost` announces a command whose credential probe found
 * no cached credentials.
 */
function stubGetHost(
  options?: {
    exists?: boolean
    stream?: Record<string, string>
    fail?: string[]
    announceSudo?: (command: string) => void
  },
) {
  const state = { run: [] as string[], streamed: [] as string[], logged: '' }
  const streamText = (command: string): string => {
    const stream = options?.stream ?? {}
    const key = Object.keys(stream).find((needle) => command.includes(needle))
    return key === undefined ? '' : stream[key]!
  }
  const fails = (command: string): boolean =>
    (options?.fail ?? []).some((needle) => command.includes(needle))
  const announceSudo = (command: string): void => {
    if (command.includes('sudo')) {
      options?.announceSudo?.(command)
    }
  }
  const host: LifecycleHost = {
    async run(command: string) {
      state.run.push(command)
      announceSudo(command)
      if (command.includes('rev-parse --is-inside-work-tree')) {
        return options?.exists === false ? { ok: false } : { ok: true }
      }
      return { ok: true }
    },
    async runStream(command: string, onOutput: (chunk: string) => void) {
      state.streamed.push(command)
      announceSudo(command)
      const text = streamText(command)
      if (text !== '') {
        onOutput(text)
      }
      if (fails(command)) {
        return { ok: false, detail: 'stubbed failure' }
      }
      return { ok: true }
    },
  }
  return { host, state }
}

describe('local-infer route read model', () => {
  let home: string

  beforeAll(() => {
    // readConfig and writeConfig key the config file on homedir(), so the
    // suite points HOME at a scratch dir and never touches the real one.
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-'))
    pointHomeAt(home)
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
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
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
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
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

describe('launch and stop route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-launch-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('renders the plan through the registered adapter and returns the launch answer', async () => {
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(result.healthy).toBe(true)
    expect(result.plan.engineId).toBe('ninfer')
  })

  it('reports the prereqs phase and threads the progress sink to the service launch', async () => {
    // The trust gate is on, so the route runs the system-dependency install as
    // the prereqs phase and reports it.
    writeConfig('ninfer', { port: 18020 }, true)
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stub service's launch records the sink the route threads and reports
    // the deploy sub-steps it would, so the test prices the full sequence the
    // card's button reads.
    let seenSink: ((step: 'prereqs' | 'download' | 'build' | 'launch') => void) | undefined
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      seenSink = options?.onProgress
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      (step) => {
        steps.push(step)
      },
      stubGetHost().host,
    )
    expect(typeof seenSink).toBe('function')
    // The route reports the prereqs phase, then threads the sink to the service,
    // which reports the deploy sub-steps.
    expect(steps).toEqual(['prereqs', 'download', 'build'])
  })

  it('skips the prereqs phase when the trust gate is off', async () => {
    // The trust gate is off, so no system-dependency install runs and the
    // prereqs phase is not reported; the sequence starts at the deploy steps.
    writeConfig('ninfer', { port: 18020 }, false)
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      (step) => {
        steps.push(step)
      },
      stubGetHost().host,
    )
    expect(steps).toEqual(['download', 'build'])
  })

  it('threads the auto-rebuild flag to the service launch', async () => {
    // The checkbox off: the route passes the flag into the service launch
    // options, which the service threads to the deploy step, which skips the
    // git sync (fetch, rebase, rebuild).
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true }
    }
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 }, autoRebuild: false },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBe(false)
    // The flag absent: the route omits the key, so the deploy step runs the
    // rebuild.
    seenOptions = undefined
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBeUndefined()
  })

  it('launches the current version and skips the deploy git sync after a Get rebase failure', async () => {
    // The checkout directory exists (a current version to launch), so the
    // launch's Get-step rebase failure is non-fatal under the override the
    // launch always sets: the launch continues with the checkout's current
    // version.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\n',
      },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true, logs: 'engine booted\n' }
    }
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR }, autoRebuild: true },
      undefined,
      stubGetHost({ exists: true, fail: ['rebase'] }).host,
    )
    // The sync failed, so the deploy's own git sync (it would hit the same
    // rebase conflict) is skipped and the checkout's current version
    // launches.
    expect(result.healthy).toBe(true)
    expect(seenOptions?.autoRebuild).toBe(false)
    // The Get error line and the continue note persist under the
    // "Launching..." separator, so the Logs section names the broken
    // rebase after a reload.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('!! git rebase')
    expect(lastLogs).toContain('engine sync failed; continuing with the current version')
    // The same run reached the configured log file. The file name carries a
    // timestamp, so the newest ninfer-model run file is the one this launch
    // wrote.
    const logFile = resolveLogPath(
      readConfig().logPath,
      'ninfer',
      undefined,
      new Date(),
      process.env.HOME ?? '',
    )
    const dir = dirname(logFile)
    const logNames = (existsSync(dir) ? readdirSync(dir) : [])
      .filter((name) => name.startsWith('ninfer-model-') && name.endsWith('.log'))
      .sort()
    expect(logNames.length).toBeGreaterThan(0)
    expect(readFileSync(join(dir, logNames[logNames.length - 1]!), 'utf8')).toContain('!! git rebase')
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('keeps the request auto-rebuild flag when the Get sync passes', async () => {
    // The Get sync passes (no stubbed failure), so the request's autoRebuild
    // threads into the deploy unchanged, on and absent.
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
      },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true }
    }
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 }, autoRebuild: true },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBe(true)
    seenOptions = undefined
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBeUndefined()
  })

  it('streams the Get-step download chunks through the launch onChunk sink', async () => {
    writeConfig('ninfer', { port: 18020, model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.downloadModel = (
      _entry: DefaultModel,
      _directory: string,
      options?: { onChunk?: (chunk: string) => void },
    ) => {
      options?.onChunk?.('42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n')
      return Promise.resolve({ ok: true })
    }
    const chunks: string[] = []
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      undefined,
      stubGetHost({ exists: false }).host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.healthy).toBe(true)
    expect(chunks).toEqual(['42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'])
  })

  it('persists the launch logs as the last run and writes the log file', async () => {
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\nlistening on 18020',
      },
    })
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-8-27b' } },
      undefined,
      stubGetHost().host,
    )
    // The last run is persisted under the "Launching..." separator, so the
    // card's Logs section shows it after a reload, and the resolved log file
    // carries the same output. The Get-step output the launch ran leads the
    // persisted run, so the launch preserves the Get logs, not wipes them.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs).toContain('model download: qwen3-8-27b has no registered default, skipped')
    expect(lastLogs.endsWith('engine booted\nlistening on 18020')).toBe(true)
    const logFile = resolveLogPath(
      readConfig().logPath,
      'ninfer',
      'qwen3-8-27b',
      new Date(),
      process.env.HOME ?? '',
    )
    // The exact timestamp the launch resolved is not known from here, so
    // assert the directory the file lands in holds a matching log.
    const dir = dirname(logFile)
    const entries = existsSync(dir) ? readdirSync(dir) : []
    expect(entries.some((name) => name.startsWith('ninfer-qwen3-8-27b-') && name.endsWith('.log'))).toBe(
      true,
    )
  })

  it('persists the Get-step output exactly once in a successful launch run', async () => {
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\nlistening on 18020',
      },
    })
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-8-27b' } },
      undefined,
      stubGetHost().host,
    )
    // The Get-step output leads the run logs composeLaunchLogs assembled in
    // the result, so the persisted run carries it once, not twice.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.match(/get complete/g)?.length).toBe(1)
  })

  it('prints the plan launch command above the run logs the card shows', async () => {
    const argv = ['infernix-serve', '/opt/hf-models/m.infernix', '--host', '127.0.0.1', '--port', '18080']
    const service = stubService([], {
      engines: [argvAdapter('infernix', argv)],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv, port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        logs: 'engine booted',
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The Get-step output the launch ran leads the result logs the route hands
    // the card, the command line follows it, and the engine output comes last.
    // The persisted last run carries the same order under the "Launching..."
    // separator, so the Logs section diagnoses the exact child process.
    expect(result.logs).toContain('get complete')
    expect(result.logs.endsWith(`${note}engine booted`)).toBe(true)
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs.endsWith(`${note}engine booted`)).toBe(true)
  })

  it('orders the build output before the launch command and the engine output', async () => {
    const argv = ['infernix-serve', '/opt/hf-models/m.infernix', '--host', '127.0.0.1', '--port', '18080']
    const buildLogs =
      '>> /engines/infernix is behind dsh-fork/main; rebasing and rebuilding.\n' +
      '$ cd /engines/infernix && cmake --preset release\nbuild ok\n'
    const service = stubService([], {
      engines: [argvAdapter('infernix', argv)],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv, port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        logs: 'engine booted',
        buildLogs,
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The Get-step output the launch ran leads, the build output follows it,
    // the launch command follows that, and the engine output comes last.
    const logs = result.logs ?? ''
    const getEnd = logs.indexOf('get complete')
    const buildStart = logs.indexOf(buildLogs)
    const noteStart = logs.indexOf(note)
    expect(getEnd).toBeGreaterThanOrEqual(0)
    expect(buildStart).toBeGreaterThan(getEnd)
    expect(noteStart).toBeGreaterThanOrEqual(buildStart + buildLogs.length)
    expect(logs.endsWith('engine booted')).toBe(true)
    // The buildLogs transport field is folded into logs and cleared.
    expect(result.buildLogs).toBeUndefined()
  })

  it('persists the launch command before the deploy so a hung launch stays readable', async () => {
    const service = stubService([], { engines: [argvAdapter('infernix', ['infernix-serve', '--port', '18080'])] })
    let logsDuringLaunch: string | undefined
    service.launch = async (plan: LaunchPlan): Promise<LaunchResult> => {
      // The route wrote the Get steps and the command line before calling the
      // service, so a reload while the deploy and health poll are in flight
      // still shows them.
      logsDuringLaunch = readConfig().lastLogs
      return { plan, healthy: true }
    }
    await launchEngine(service, { engine: 'infernix', config: {} }, undefined, stubGetHost().host)
    expect(logsDuringLaunch).toContain('get complete')
    expect(logsDuringLaunch?.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
  })

  it('reports the launch command even when the deploy failed silently', async () => {
    const service = stubService([], {
      engines: [argvAdapter('infernix', ['infernix-serve', '--port', '18080'])],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv: ['infernix-serve'], port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: false,
        detail: 'build failed',
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    // A deploy that produced no engine output still carries the Get steps it
    // ran and the command it tried to run, so the Logs section is never blank
    // on a failed launch. The persisted last run leads with the "Launching..."
    // separator.
    expect(result.logs).toContain('get complete')
    expect(result.logs.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
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

  it('persists the launch record on the provider entry the launch names', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          argv: ['ninfer-serve', '/models/m.ninfer', '--port', '18020'],
          port: 18020,
          modelId: 'qwen3-27b',
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
        pid: 12345,
        parentPid: 999,
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      },
      undefined,
      stubGetHost().host,
    )
    // The record the restart re-link prices: the engine pid, the DSH parent
    // pid, the launch arguments, and the previous-pid list the core builder
    // seeds from the parent pid.
    const record = readConfig().providers[0]?.launch
    expect(record?.pid).toBe(12345)
    expect(record?.parentPid).toBe(999)
    expect(record?.argv).toEqual(['ninfer-serve', '/models/m.ninfer', '--port', '18020'])
    expect(record?.previousPids).toEqual([999])
    expect(record?.engineId).toBe('ninfer')
    expect(record?.port).toBe(18020)
    expect(record?.modelId).toBe('qwen3-27b')
    expect(typeof record?.startedAt).toBe('string')
  })

  it('persists the launch record on the engine+model entry when the launch names no provider', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          argv: ['ninfer-serve'],
          port: 18020,
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
        pid: 12345,
        parentPid: 999,
      },
    })
    // No providerId: the route falls back to the stored entry with the same
    // engine and model.
    await launchEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b' } },
      undefined,
      stubGetHost().host,
    )
    expect(readConfig().providers[0]?.launch?.pid).toBe(12345)
  })

  it('persists no launch record when the deploy started no tracked process', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          port: 18020,
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      },
      undefined,
      stubGetHost().host,
    )
    expect(readConfig().providers[0]?.launch).toBeUndefined()
  })

  it('clears the launch record on a stop of the named provider', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [888, 999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The record (the previous-pid list with it) is gone, so a recycled pid
    // cannot re-link an engine the user just stopped.
    const stored = readConfig()
    expect(stored.providers[0]?.launch).toBeUndefined()
  })

  it('stamps the re-adopted engine pid from the stored launch record', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          previousPids: [888, 999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The pid the adapter signals through the host: the process a DSH restart
    // re-adopted, which the adapter tracks no child handle for.
    expect(stoppedPlan?.pid).toBe(12345)
  })

  it('stamps no pid when the target entry carries no launch record', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // A fresh stop of an idle engine names nothing to signal.
    expect(stoppedPlan?.pid).toBeUndefined()
  })

  it('persists a stop-failure note to the last-run logs and the log file', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        {
          id: 'p1',
          engine: 'ninfer',
          config: { model: 'qwen3-27b' },
          platform: {},
          launch: {
            pid: 12345,
            startedAt: '2026-10-14T12:00:00.000Z',
            argv: ['ninfer-serve'],
            previousPids: [999],
            engineId: 'ninfer',
            port: 18020,
            modelId: 'qwen3-27b',
          },
        },
      ],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (): Promise<void> => {
      throw new Error('stop: signal pid 12345 failed: No such process')
    }
    await expect(
      stopEngine(service, {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      }),
    ).rejects.toThrow('stop: signal pid 12345 failed')
    // The failure note landed in the last-run logs (the card's Logs section)
    // beside the previous run, and the record stays, so the engine the kill
    // could not reach is not read as stopped.
    const stored = readConfig()
    expect(stored.lastLogs).toContain('engine up')
    expect(stored.lastLogs).toContain(
      '[local-infer] stop failed for ninfer (qwen3-27b): stop: signal pid 12345 failed: No such process',
    )
    expect(stored.providers[0]?.launch).toBeDefined()
    // The note also reached the configured log file, the same per-run rule the
    // launch step applies.
    const logFile = resolveLogPath(
      stored.logPath,
      'ninfer',
      'qwen3-27b',
      new Date(),
      process.env.HOME ?? '',
    )
    const dir = dirname(logFile)
    const entries = existsSync(dir) ? readdirSync(dir) : []
    expect(
      entries.some((name) => name.startsWith('ninfer-qwen3-27b-') && name.endsWith('.log')),
    ).toBe(true)
  })

  it('writes no stop-failure note when the stop succeeds', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        {
          id: 'p1',
          engine: 'ninfer',
          config: { model: 'qwen3-27b' },
          platform: {},
          launch: {
            pid: 12345,
            startedAt: '2026-10-14T12:00:00.000Z',
            argv: ['ninfer-serve'],
            previousPids: [999],
            engineId: 'ninfer',
            port: 18020,
            modelId: 'qwen3-27b',
          },
        },
      ],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The last-run logs stay as the launch left them, and the record is
    // cleared with the stop.
    const stored = readConfig()
    expect(stored.lastLogs).toBe('engine up\n')
    expect(stored.providers[0]?.launch).toBeUndefined()
  })
})

describe('platform config (§3.10) round trip and launch pass-through', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-platform-'))
    pointHomeAt(home)
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

  it('seeds the engine platform defaults in the summary engine list', async () => {
    writeConfig('ninfer', {}, false, {})
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    const ninfer = summary.engines.find((entry) => entry.id === 'ninfer')
    expect(ninfer?.defaultBuildCommand).toBe(
      'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
    )
    expect(ninfer?.defaultDockerTag).toBe('ghcr.io/iamwavecut/ninfer-all')
    // A docker-only engine (compose vLLM) carries a docker tag and no local
    // build command; a local-only engine (Infernix) is the reverse. The compose
    // engine's tag field seeds the compose arguments (the profile the up runs).
    const hyperqwen = summary.engines.find((entry) => entry.id === 'hyperqwen')
    expect(hyperqwen?.defaultDockerTag).toBe('--profile single')
    expect(hyperqwen?.defaultBuildCommand).toBeUndefined()
    const infernix = summary.engines.find((entry) => entry.id === 'infernix')
    expect(infernix?.defaultBuildCommand).toBe('cd {dir} && cmake --preset release && cmake --build build -j')
    expect(infernix?.defaultDockerTag).toBeUndefined()
    // Every engine entry carries its default checkout home, so the card's
    // Engine Directory placeholder shows the real path for the selected engine.
    expect(ninfer?.defaultEngineDirectory).toBe(dshEngineCacheDirectory('ninfer'))
    expect(infernix?.defaultEngineDirectory).toBe(dshEngineCacheDirectory('infernix'))
  })

  it('round-trips the build commands and docker tag platform overrides', async () => {
    writeConfig('ninfer', {}, false, {
      ninfer: {
        buildCommands: 'cmake -S {dir} -B {dir}/build',
        dockerTag: 'ghcr.io/iamwavecut/ninfer-all:dev',
      },
    })
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.platformConfigs).toEqual({
      ninfer: {
        buildCommands: 'cmake -S {dir} -B {dir}/build',
        dockerTag: 'ghcr.io/iamwavecut/ninfer-all:dev',
      },
    })
  })

  it('registers the request platform override with the service before launch', async () => {
    let seen: EnginePlatformConfig | undefined
    const service = stubService([], {
      onPlatform: (config: EnginePlatformConfig) => {
        seen = config
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { port: 18020 },
        platform: { engineDirectory: '/home/derek/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
      },
      undefined,
      stubGetHost().host,
    )
    expect(seen).toEqual({
      engineId: 'ninfer',
      engineDirectory: '/home/derek/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
  })

  it('registers the fallback engine directory when the launch request carries no platform', async () => {
    // Reset the stored platform map so the test reads a clean entry, not the
    // build commands and docker tag a sibling test wrote.
    writeConfig('ninfer', { port: 18020 }, false, {})
    let seen: EnginePlatformConfig | undefined
    const service = stubService([], {
      onPlatform: (config: EnginePlatformConfig) => {
        seen = config
      },
    })
    // A launch with no Engine Directory override falls back to the engine's
    // default checkout home (~/.cache/dsh/infer/<engine-id>), so the deploy
    // step resolves a relative launch path against a real checkout; the
    // fallback rides the in-memory registry only, never the stored map.
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seen).toEqual({
      engineId: 'ninfer',
      engineDirectory: dshEngineCacheDirectory('ninfer'),
    })
    // The resolved default never leaks into storage: the stored platform
    // map stays the clean entry the test wrote.
    expect(readConfig().platform).toEqual({})
  })
})

describe('register and unregister route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-register-'))
    pointHomeAt(home)
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
    // The vision flag is unset, so the model row publishes the text-only
    // input types.
    expect(seen?.model).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
      contextWindow: 32768,
      input: ['text'],
    })
    expect(seen?.options).toEqual({ agentDefault: true })
    expect(seen?.plan.engineId).toBe('ninfer')
  })

  it('publishes the Image input type when the vision flag is set', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'ninfer', config: { vision: true } })
    expect(seen?.model?.input).toEqual(['text', 'image'])
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

  it('registers the model the adapter discovers live, ahead of its modelRef', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    // Stands in for Strata: a placeholder modelRef, a live discovery of the
    // model the running engine auto-selected, and declared modalities (its
    // vision enum defaults to on).
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => ({
        id: 'qwen3.8-flash-next-iq3_s',
        name: 'qwen3.8-flash-next-iq3_s',
      }),
      modelInput: () => ['text', 'image'],
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    // The discovered id wins over the placeholder modelRef, and the declared
    // modalities win over the boolean vision flag (unset here, so the flag
    // path would have published text-only).
    expect(seen?.model).toEqual({
      id: 'qwen3.8-flash-next-iq3_s',
      name: 'qwen3.8-flash-next-iq3_s',
      contextWindow: 32768,
      input: ['text', 'image'],
    })
  })

  it('falls back to the adapter modelRef when live discovery finds nothing', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    // A down engine discovers nothing, so the register step publishes the
    // modelRef row and the card stays consistent with the summary flag.
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => undefined,
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    expect(seen?.model?.id).toBe('strata')
    expect(seen?.model?.name).toBe('Strata')
  })

  it('removes the exact discovered entry the register step wrote', async () => {
    let registered: { providerId: string; modelId: string } | undefined
    let removed: { providerId: string; modelId: string } | undefined
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => ({
        id: 'qwen3.8-flash-next-iq3_s',
        name: 'qwen3.8-flash-next-iq3_s',
      }),
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        registered = {
          providerId: providerIdFor(args.plan.engineId, args.model.id, 'local'),
          modelId: args.model.id,
        }
      },
      onRemove: (args) => {
        removed = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    const result = await unregisterFor(service, { engine: 'strata', config: { port: 8090 } })
    expect(result).toEqual({ removed: true })
    // Discovery resolves the same served id in both steps, so the removal
    // targets the discovered entry, not the placeholder the modelRef names.
    expect(removed).toEqual(registered)
    expect(removed?.modelId).toBe('qwen3.8-flash-next-iq3_s')
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
    expect(seen).toEqual({ providerId: 'ninfer-local-qwen38-27b', modelId: 'Qwen3.8-27B' })
  })

  it('removes the exact provider and model the register step wrote, across the full flow', async () => {
    let registered: { providerId: string; modelId: string } | undefined
    let removed: { providerId: string; modelId: string } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        // The register step writes the row through buildModelEntry, so the
        // provider id derives from the plan engine id and the row model id.
        registered = {
          providerId: providerIdFor(args.plan.engineId, args.model.id, 'local'),
          modelId: args.model.id,
        }
      },
      onRemove: (args) => {
        removed = args
      },
    })
    const config = { model: 'qwen3-27b', maxContext: 32768 }
    await registerFor(service, { engine: 'ninfer', config })
    const result = await unregisterFor(service, { engine: 'ninfer', config })
    expect(result).toEqual({ removed: true })
    // The unregister step must target the exact entry the register step wrote,
    // so the DSH settings row is removed, not left behind.
    expect(removed).toEqual(registered)
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
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  interface FakeRes {
    status: number
    body: string
    closeListeners: Array<() => void>
  }

  function fakeRes(): FakeRes {
    const res = {
      status: 0,
      body: '',
      closeListeners: [] as Array<() => void>,
      writeHead(status: number): FakeRes {
        res.status = status
        return res
      },
      // The streaming routes (the launch NDJSON) write lines as they land; the
      // fake accumulates them so the test reads the full stream.
      write(chunk: string): FakeRes {
        res.body += chunk
        return res
      },
      end(body?: string): FakeRes {
        // A streamed body (the launch NDJSON) is already accumulated; a plain
        // end body replaces it.
        res.body = body !== undefined ? body : res.body
        return res
      },
      // The stream routes watch the response's client disconnect (the node
      // 'close' before the route ends); the fake captures the listener so a
      // test simulates the card's Cancel closing the stream.
      on(event: string, listener: (...args: unknown[]) => void): FakeRes {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
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

  function registeredRoutes(service: LocalInferService, launchHost?: LifecycleHost) {
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
      undefined,
      launchHost,
    )
    return routes
  }

  it('serves the deps route and maps the install route through the gate', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const routes = registeredRoutes(stubService([], { deps: [TEST_DEP] }))
    const paths = routes.map((route) => route.path)
    expect(paths).toEqual(EXPECTED_ROUTE_PATHS)

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
    expect(removed).toEqual({ providerId: 'ninfer-local-qwen38-27b', modelId: 'Qwen3.8-27B' })
  })

  it('answers 405 for the wrong method on every route', async () => {
    const routes = registeredRoutes(stubService([]))
    expect(routes.map((route) => route.path)).toEqual(EXPECTED_ROUTE_PATHS)
    for (const route of routes) {
      const res = fakeRes()
      // Each route takes one method; the wrong one is its complement, read
      // from the shared route table (the GET routes take a POST, the POST
      // routes a GET).
      const method = wrongMethodFor(route.path)
      await route.handler(
        method === 'POST' ? fakeReq('POST', route.path, '{}') : fakeReq('GET', route.path),
        res,
      )
      expect(res.status).toBe(405)
    }
  })

  it('streams the launch as NDJSON step events then a result event', async () => {
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stub service's launch reports the deploy sub-steps through the sink
    // the route threads, so the stream carries the full phase sequence the
    // card's button reads.
    service.launch = async (
      plan: LaunchPlan,
      options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void },
    ): Promise<LaunchResult> => {
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      options?.onProgress?.('launch')
      return { plan, healthy: true }
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    expect(res.status).toBe(200)
    // The stream is NDJSON: a step event as each phase begins, then a final
    // result event. The card's button reads the step that is running.
    const lines = res.body.split('\n').filter((line) => line !== '')
    const events = lines.map((line) => JSON.parse(line))
    expect(events.map((event) => (event.step !== undefined ? event.step : 'result'))).toEqual([
      'prereqs',
      'download',
      'build',
      'launch',
      'result',
    ])
    expect(events[events.length - 1].result.healthy).toBe(true)
  })

  it('streams a sudo event and persists the CLI note when the host announces a waiting sudo', async () => {
    writeConfig('ninfer', {}, true)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    // The stub host plays the guarded node host: the body's sudo build
    // command is announced through the service's notify seam before it
    // runs, the way the real host announces after a credential probe that
    // found nothing cached.
    const host = stubGetHost({
      announceSudo: (command) => service.notifySudoNeeded(command),
    }).host
    const routes = registeredRoutes(service, host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({
          engine: 'ninfer',
          platform: { buildCommands: 'sudo ln -sf ./build/engine /usr/local/bin/engine' },
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const lines = res.body.split('\n').filter((line) => line !== '')
    // The sudo event is its own exact NDJSON line.
    expect(lines).toContain('{"sudo":true}')
    const kinds = lines
      .map((line) => JSON.parse(line))
      .map((event) =>
        event.step !== undefined
          ? event.step
          : event.progress !== undefined
            ? 'progress'
            : event.sudo === true
              ? 'sudo'
              : 'result',
      )
    // The sudo event lands between the phases and the result, while the
    // command is still waiting on the prompt.
    expect(kinds).toEqual(['prereqs', 'sudo', 'result'])
    // The note line lands in the persisted last-run logs exactly once: the
    // run's log sink carries it into the composed run.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs).toContain(`${SUDO_CLI_NOTE}\n`)
    expect(lastLogs.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    // The note also reaches the live hub buffer the logs route streams,
    // under the draft launch's engine-id key.
    expect(service.readRunLog('ninfer').text).toContain(SUDO_CLI_NOTE)
    // The run registered its hook under the draft's key and cleared it when
    // it settled: one live hook at register, none at dispose.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('leaves no sudo observer registered after a failing launch run', async () => {
    writeConfig('ninfer', {}, false)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    service.launch = async (): Promise<LaunchResult> => {
      throw new Error('deploy exploded')
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    // The broken deploy still settles the stream with an unhealthy result.
    const events = res.body.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
    expect(events[events.length - 1].result.healthy).toBe(false)
    expect(events[events.length - 1].result.detail).toContain('deploy exploded')
    // The failed run unregistered its hook too, so a second launch never
    // announces through the dead run's stream writer.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('streams a progress event between the step and result events', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stubbed download invokes the injected onChunk with a tqdm line, the
    // way the real runner hands the hf download's streamed stderr to it.
    const tqdmLine = 'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n'
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { onChunk?: (chunk: string) => void }) => {
      options?.onChunk?.(tqdmLine)
      return Promise.resolve({ ok: true })
    }
    const routes = registeredRoutes(service, stubGetHost({ exists: false }).host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    // The stream carries the step event, the progress event the download's
    // tqdm chunk folded into, and the result event, in order.
    const events = res.body.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
    const kinds = events.map((event) =>
      event.step !== undefined ? 'step' : event.progress !== undefined ? 'progress' : 'result',
    )
    expect(kinds).toEqual(['step', 'progress', 'result'])
    expect(events[1].progress).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
    expect(events[events.length - 1].result.healthy).toBe(true)
  })

  it('reads the auto-rebuild flag from the launch body and threads it to the service', async () => {
    let seenAutoRebuild: boolean | undefined
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenAutoRebuild = options?.autoRebuild
      return { plan, healthy: true }
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    // The checkbox off in the card body: the flag lands on the service launch.
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', autoRebuild: false })),
      fakeRes(),
    )
    expect(seenAutoRebuild).toBe(false)
    // A body without the key (a non-boolean value reads as absent, too): the
    // deploy step runs the rebuild.
    seenAutoRebuild = undefined
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', autoRebuild: 'no' })),
      fakeRes(),
    )
    expect(seenAutoRebuild).toBeUndefined()
  })

  it('aborts the in-flight launch download on a client disconnect and persists the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal: the
    // in-flight hf child the cancel interrupts.
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { signal?: AbortSignal }) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost({ exists: false }).host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    const pending = launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    // Let the handler reach the hanging download, then the card's provider-form
    // Cancel closes the stream: the route aborts the in-flight download.
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    // The persisted run carries the "Canceled" line, so the Logs section and
    // the log file read the launch as canceled.
    expect(readConfig().lastLogs).toContain('--- Canceled')
  })

  it('aborts the in-flight model download on a client disconnect and marks the run canceled', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal: the
    // in-flight hf child the cancel interrupts, the launch route's rule.
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: DownloadModelOptions) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost().host)
    const downloadRoute = routes.find((route) => route.path === '/local-infer/download')
    const res = fakeRes()
    const pending = downloadRoute?.handler(
      fakeReq('POST', '/local-infer/download', JSON.stringify({ engine: 'ninfer', model: 'qwen3-27b' })),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    // The live run ends on the "Canceled" line and settles (running false):
    // the download card's Logs tail reads the cancel the launch reads.
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
    // The persisted section carries the seed, the failure, and the cancel.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('--- Canceled')
  })

  it('aborts the in-flight chat-template download on a client disconnect and marks the run canceled', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    const service = stubService([])
    service.downloadChatTemplate = (
      _repo: string,
      _directory: string,
      options?: DownloadModelOptions,
    ) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost().host)
    const templateRoute = routes.find((route) => route.path === '/local-infer/chat-template')
    const res = fakeRes()
    const pending = templateRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({ engine: 'ninfer', template: 'neroued/Qwen3.8-27B/chat_template.jinja' }),
      ),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
  })

  it('stops the entry through the stop route and clears its launch record', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, true, undefined, true, [
      {
        id: 'stop-route',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 4242,
          startedAt: '2026-01-01T00:00:00.000Z',
          engineId: 'ninfer',
          argv: ['ninfer-serve'],
          previousPids: [],
        },
      },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([])
    service.stop = async (plan: LaunchPlan): Promise<void> => {
      stoppedPlan = plan
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const stopRoute = routes.find((route) => route.path === '/local-infer/stop')
    const res = fakeRes()
    await stopRoute?.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', providerId: 'stop-route' })),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ stopped: true })
    // The stop plan carries the record's pid, so a re-adopted engine's stop
    // signals the process the host did not spawn.
    expect(stoppedPlan?.pid).toBe(4242)
    // The cleared record is gone from the file, so a recycled pid cannot
    // re-link the engine the user just stopped.
    const entry = readConfig().providers.find((provider) => provider.id === 'stop-route')
    expect(entry?.launch).toBeUndefined()
  })

  it("answers 500 and persists the note when the stop route's stop fails", async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, true, undefined, true, [
      { id: 'stop-fail', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    service.stop = async (): Promise<void> => {
      throw new Error('container still running')
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const stopRoute = routes.find((route) => route.path === '/local-infer/stop')
    const res = fakeRes()
    await stopRoute?.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', providerId: 'stop-fail' })),
      res,
    )
    // The failure answers 500 so the card's stop deadline settles the entry
    // to the red Logs state, and the live run carries the failure note.
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body).error).toContain('container still running')
    expect(service.readRunLog('stop-fail').text).toContain('container still running')
    expect(service.readRunLog('stop-fail').running).toBe(false)
  })
})

describe('route handler error branches', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-err-'))
    pointHomeAt(home)
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

  it('serves the chat-template route and maps the service answer through', async () => {
    let seen: { repo: string; directory: string } | undefined
    const service = stubService([], {
      onDownloadChatTemplate: (args) => {
        seen = args
      },
    })
    const list = routes(service)
    const chatTemplate = find(list, '/local-infer/chat-template')
    const res = fakeRes()
    await chatTemplate.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({
          engine: 'ninfer',
          template: 'froggeric/Qwen-Fixed-Chat-Templates',
          directory: '/custom/models',
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(seen?.repo).toBe('froggeric/Qwen-Fixed-Chat-Templates')
    expect(seen?.directory).toBe('/custom/models')
  })

  it('answers 400 for a chat template that is not an HF repo reference', async () => {
    const list = routes(stubService([]))
    const chatTemplate = find(list, '/local-infer/chat-template')
    const res = fakeRes()
    await chatTemplate.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({ template: '/local/path/chat_template.jinja' }),
      ),
      res,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('HF repo reference')
  })
})

describe('model defaults, status, and download read model', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-models-route-'))
    pointHomeAt(home)
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
        id: 'qwen3-27b-swift15',
        label: 'Ninfer Qwen3.8-27B (Swift 1.5)',
        url: 'https://huggingface.co/kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
      },
      {
        id: 'qwen36-35b',
        label: 'Ninfer Qwen3.6-35B',
        url: 'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      },
    ])
    // Strata carries the two models the README links, so the summary seeds
    // them and the status resolves the first default (Gyro).
    const strata = await buildSummary(stubService([]), { engine: 'strata', config: {} })
    expect(strata.modelDefaults.map((entry) => entry.id)).toEqual(['gyro-s', 'ist-das-2.00bpw'])
    expect(strata.modelStatus?.modelId).toBe('gyro-s')
  })

  it('leaves the config model directory unset when the user named none', async () => {
    // No backfill: the config the card edits carries no modelDirectory key,
    // so a Save of a default install never stores a fake override. The
    // display value still names the hub cache root (nothing is cached).
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.config.modelDirectory).toBeUndefined()
    expect(summary.modelDirectory).toBe(MODEL_DIR)
  })

  it('shows the hub-cache snapshot directory when the artifact is cached', async () => {
    // No override and the artifact present in the fake hub cache under the
    // stub's default directory: the displayed model directory is the
    // snapshot holding it (the hf download result), never the hub root and
    // never persisted back into the config.
    const snapshot = join(
      MODEL_DIR,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    try {
      const summary = await buildSummary(stubService([]), {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
      })
      expect(summary.modelDirectory).toBe(snapshot)
      expect(summary.config.modelDirectory).toBeUndefined()
      // The layout stays the hub cache (the command carries no --local-dir).
      expect(summary.modelStatus?.downloadCommand).not.toContain('--local-dir')
    } finally {
      rmSync(join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('keeps a user-named directory over the default', async () => {
    const summary = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { modelDirectory: '/custom/models' },
    })
    expect(summary.config.modelDirectory).toBe('/custom/models')
    expect(summary.modelDirectory).toBe('/custom/models')
    expect(summary.modelStatus?.downloadCommand).toContain('--local-dir /custom/models')
  })

  it('reads an absent model as the no-CLI row with the download command', async () => {
    // No modelDirectory override means the hub-cache layout: the command
    // carries no --local-dir, so the hf CLI writes into the hub cache (the
    // raw config decides the layout, never a backfilled default).
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
      downloadCommand: `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --format human`,
    })
  })

  it('carries the chat-template status for an HF repo reference, null for a local path', async () => {
    const withTemplate = await buildSummary(stubService([], { hfCliPath: '/usr/bin/hf' }), {
      engine: 'ninfer',
      config: { chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
    })
    // No modelDirectory override means the hub-cache layout: the command
    // carries no --local-dir (the raw config decides the layout).
    expect(withTemplate.chatTemplateStatus).toEqual({
      repo: 'froggeric/Qwen-Fixed-Chat-Templates',
      label: 'Froggeric22 (Qwen fixed chat templates)',
      present: false,
      hfCli: true,
      downloadCommand: `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --format human`,
    })

    // A local path is not an HF repo reference, so the status reads as null.
    const withPath = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { chatTemplate: '/models/chat_template.jinja' },
    })
    expect(withPath.chatTemplateStatus).toBeNull()

    // No template selected reads as null too.
    const noTemplate = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(noTemplate.chatTemplateStatus).toBeNull()
  })

  it('reports the hf CLI detected when the probe finds it', async () => {
    const summary = await buildSummary(stubService([], { hfCliPath: '/usr/local/bin/hf' }), {
      engine: 'ninfer',
      config: {},
    })
    expect(summary.modelStatus?.hfCli).toBe(true)
  })

  it('reads the model as present when its artifact file is in the directory', async () => {
    // An explicit directory override keeps the flat layout: the presence
    // check looks for the artifact file in it directly.
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'weights')
    const summary = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(summary.modelStatus?.present).toBe(true)
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'))
  })

  it('reads the model as present through the hub-cache snapshot when no override names one', async () => {
    // The default (no override) resolves presence through the deterministic
    // hub-cache snapshot pick: a bare blobs folder left by any download no
    // longer reads as present on its own.
    const modelRoot = join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer')
    mkdirSync(join(modelRoot, 'blobs'), { recursive: true })
    try {
      const bare = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
      expect(bare.modelStatus?.present).toBe(false)
      const snapshot = join(modelRoot, 'snapshots', 'cafebabe1234567890')
      mkdirSync(snapshot, { recursive: true })
      writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
      const cached = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
      expect(cached.modelStatus?.present).toBe(true)
    } finally {
      rmSync(modelRoot, { recursive: true, force: true })
    }
  })

  it('resolves the download through the service with the request directory', async () => {
    let seen: { entry: DefaultModel; directory: string; useHubCache: boolean } | undefined
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
    // A request-named directory keeps the flat --local-dir layout.
    expect(seen?.useHubCache).toBe(false)
  })

  it('falls back to the stored config directory and model when the request names none', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: '/stored/models' }, false)
    let seen: { entry: DefaultModel; directory: string; useHubCache: boolean } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    await downloadFor(service, {})
    expect(seen?.entry?.modelId).toBe('qwen3-27b')
    expect(seen?.directory).toBe('/stored/models')
    // A stored-config directory keeps the flat --local-dir layout too.
    expect(seen?.useHubCache).toBe(false)
  })

  it('follows the request, stored, and hub-cache precedence with the artifact cached', async () => {
    // The three levels in one run, with the artifact already cached in the
    // fake hub cache: a cached artifact never turns the download base into
    // the resolved snapshot directory (the hf CLI resolves its own snapshot
    // destination), so the route keeps the hub cache root as the base.
    const snapshot = join(
      MODEL_DIR,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: '/stored/models' }, false)
    const seen: { directory: string; useHubCache: boolean }[] = []
    const service = stubService([], {
      onDownload: (args) => {
        seen.push({ directory: args.directory, useHubCache: args.useHubCache })
      },
    })
    try {
      // Level 1: the request directory wins over the stored config.
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b', directory: '/req/models' })
      // Level 2: the stored config wins over the hub cache root.
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b' })
      // Level 3: neither names one, so the hub cache root is the base and the
      // hub-cache layout applies (no --local-dir; the hf CLI picks the snapshot).
      writeConfig('ninfer', { model: 'qwen3-27b' }, false)
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b' })
      expect(seen).toEqual([
        { directory: '/req/models', useHubCache: false },
        { directory: '/stored/models', useHubCache: false },
        { directory: MODEL_DIR, useHubCache: true },
      ])
    } finally {
      rmSync(join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('refuses a download for a model no default names with a 404', async () => {
    await expect(downloadFor(stubService([]), { engine: 'strata', model: 'qwen3-27b' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })

  it('persists the download run under the "Downloading..." separator', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b', modelDirectory: MODEL_DIR }, false)
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
      stubService([]),
    )
    const route = routes.find((r) => r.path === '/local-infer/download')!
    const res = {
      status: 0,
      body: '' as string,
      writeHead(status: number): unknown {
        res.status = status
        return res
      },
      end(body?: string): unknown {
        res.body = body ?? ''
        return res
      },
    }
    await route.handler(
      {
        method: 'POST',
        url: '/local-infer/download',
        destroy(): void {
          /* the handler only destroys on an oversize body */
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
          yield Buffer.from(
            JSON.stringify({ engine: 'ninfer', model: 'qwen36-35b', directory: MODEL_DIR }),
          )
        },
      },
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    // The download run persists under the "Downloading..." separator, so the
    // Logs section and the log file show the download beside the Get and launch
    // runs.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('download complete')
  })

  it('seeds the summary with the directory-scanned model files for the engine', async () => {
    // A modelDirectory override keeps the flat layout, so the scan lists the
    // directory entries through listModelDirectory (the hub-cache scan is the
    // default case, served by listModelCache).
    const service = stubService([], {
      modelEntries: [
        { name: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer', isDirectory: false },
        { name: 'Qwen3.8-27B-Q4_K_M.gguf', isDirectory: false },
        { name: 'Qwen3.8-27B-W4A16-AutoRound-fast', isDirectory: true, hasSafetensors: true },
        { name: 'froggeric_Qwen-Fixed-Chat-Templates', isDirectory: true, hasSafetensors: false },
      ],
    })
    const ninfer = await buildSummary(service, {
      engine: 'ninfer',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(ninfer.modelFiles).toEqual([
      'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    ])
    const llamacpp = await buildSummary(service, {
      engine: 'llamacpp',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(llamacpp.modelFiles).toEqual(['Qwen3.8-27B-Q4_K_M.gguf'])
    const hyperqwen = await buildSummary(service, {
      engine: 'hyperqwen',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(hyperqwen.modelFiles).toEqual(['Qwen3.8-27B-W4A16-AutoRound-fast'])
    // Strata offers no dense-Qwen model, so the scan reads as empty.
    const strata = await buildSummary(service, {
      engine: 'strata',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(strata.modelFiles).toEqual([])
  })
})

describe('provider list round trip', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-prov-'))
    pointHomeAt(home)
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

  it('re-links recorded providers in the summary and clears the dead records', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
      {
        id: 'p2',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 54321,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18021,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const reLinked: string[] = []
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'running', p2: 'stopped' }),
      reLinkProviders: async (entries) => {
        reLinked.push(...entries.map((entry) => entry.id))
        return { p1: 'adopted', p2: 'dead' }
      },
    })
    await buildSummary(service, { engine: 'ninfer', config: {} })
    // The summary prices every recorded provider through the re-link, and a
    // dead engine clears its record (the previous-pid list with it) so a
    // recycled pid cannot re-link.
    expect(reLinked).toEqual(['p1', 'p2'])
    const stored = readConfig()
    expect(stored.providers[0]?.launch?.pid).toBe(12345)
    expect(stored.providers[1]?.launch).toBeUndefined()
  })

  it('sets the Unknown Engine(s) readout when a provider reads as unsure', async () => {
    // A foreign engine the detector saw but could not tie to a model reads as
    // unsure, so the meter's "Unknown Engine(s)" section names the VRAM those
    // programs are holding (the OS-reserve segment, the GPU's used VRAM).
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'unsure' }),
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.unknownEngines).toEqual({ bytes: 10 })
  })

  it('omits the Unknown Engine(s) readout when no provider reads as unsure', async () => {
    // A confirmed-running provider (or no providers at all) means no foreign
    // engine, so the section stays out of the meter.
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'running' }),
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.unknownEngines).toBeNull()
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

  it('keeps the provider list intact on a settings-only save', async () => {
    // The help and allow-run toggles persist the global fields through the
    // save route with settingsOnly set. That must not mint a new entry, so a
    // toggle never duplicates the list the way an id-less save used to.
    rmSync(localInferConfigPath(), { force: true })
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
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: false, settingsOnly: true }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // The toggle persists, and the single stored entry survives untouched:
    // no minted id, no prepended duplicate.
    expect(stored.showHelp).toBe(false)
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    // A second settings-only save keeps the list at one entry, so repeated
    // toggles do not accumulate duplicates.
    const again = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: true, settingsOnly: true }),
      ),
      again,
    )
    expect(again.status).toBe(200)
    expect(readConfig().providers).toHaveLength(1)
    expect(readConfig().providers[0]?.id).toBe('p1')
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

  it('updates a matching stored provider in place on an id-less save (no duplicate)', async () => {
    // A "New provider" save that matches a stored entry (the same engine,
    // config, and platform) updates it in place instead of minting a
    // duplicate, so a "New provider" then Save without a change never
    // prepends a second copy of the same provider.
    rmSync(localInferConfigPath(), { force: true })
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // The matching entry is updated in place (its id is kept), not duplicated.
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-27b' })
  })

  it('mints a new entry on an id-less save that matches no stored provider', async () => {
    rmSync(localInferConfigPath(), { force: true })
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-35b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // A different config does not match the stored entry, so a new id is
    // minted and the entry is prepended.
    expect(stored.providers).toHaveLength(2)
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
    expect(stored.providers[0]?.id).not.toBe('p1')
    expect(stored.providers[1]?.id).toBe('p1')
  })

  it('carries the launch record over when a save updates the entry in place', async () => {
    // Editing a running provider's config must not drop the record the
    // restart re-link prices, so the save keeps the entry's launch record.
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
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
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
    expect(stored.providers[0]?.launch?.pid).toBe(12345)
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

  it('sets registered to true when modelIsRegistered returns true', async () => {
    const service = stubService([], { modelIsRegisteredResult: true })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.registered).toBe(true)
  })

  it('sets registered to false when modelIsRegistered returns false', async () => {
    const service = stubService([], { modelIsRegisteredResult: false })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.registered).toBe(false)
  })
})

describe('VRAM estimator on the sane default configs', () => {
  // A real LocalInfer service with the NInfer measured VramModels registered,
  // so the estimate resolves a model the way the running plugin does. The
  // stub service prices a fixed breakdown, so it never exercises the model
  // resolution the empty-meter bug lives in. detectHardware is pinned to the
  // suite's 24 GiB card, so the meter prices a real budget without a live
  // nvidia-smi probe.
  class FixedHwLocalInfer extends LocalInfer {
    async detectHardware() {
      return HW
    }
  }

  async function realService() {
    const ctx = new Context()
    await ctx.plugin(FixedHwLocalInfer)
    // Register the NInfer measured VramModels, the built-in presets, and the
    // engine adapters, so the estimate resolves a real model and the defaults
    // resolver prices a sane budget (the preset's kvDtype and max-context).
    applyProviders(ctx)
    return ctx.localInfer
  }

  it('prices the default config (no model) against the engine first default model', async () => {
    const service = await realService()
    // The default config names no model, so the summary prices the engine's
    // first default model (qwen3-27b) rather than reading as not-measured.
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.source).not.toBe('not-measured')
    expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
  })

  it('prices each registered NInfer default model so the chart renders', async () => {
    const service = await realService()
    // The NInfer default list names qwen3-27b and qwen3-27b-swift15, both of
    // which carry a measured VramModel, so each selection prices a real
    // budget and the meter's segments are non-zero.
    for (const modelId of ['qwen3-27b', 'qwen3-27b-swift15']) {
      const summary = await buildSummary(service, {
        engine: 'ninfer',
        config: { model: modelId },
      })
      expect(summary.meterModel.source).not.toBe('not-measured')
      expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
    }
  })

  it('prices a directory-scanned model file through its registry key', async () => {
    const service = await realService()
    // The card's Model field can carry an artifact file name from the
    // directory scan (a .ninfer file), not a registry key. The default list
    // maps that file to the registry key the estimator knows, so a scanned
    // model prices a real VramModel rather than reading as not-measured.
    const summary = await buildSummary(service, {
      engine: 'ninfer',
      config: { model: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer' },
    })
    expect(summary.meterModel.source).not.toBe('not-measured')
    expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
  })
})

describe('get route (git sync, deps, build)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-get-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function fakeStreamRes() {
    const res = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
      chunks: [] as string[],
      closeListeners: [] as Array<() => void>,
      writeHead(status: number, headers?: Record<string, string>) {
        res.status = status
        Object.assign(res.headers, headers ?? {})
        return res
      },
      write(chunk: string) {
        res.chunks.push(chunk)
        return true
      },
      end(body?: string) {
        res.body = body ?? ''
        return res
      },
      // The get route watches the response's client disconnect (the node
      // 'close' before the route ends); the fake captures the listener so a
      // test simulates the card's Cancel closing the stream.
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  // ndjsonEvents parses the get route's NDJSON stream chunks into events, so
  // a test reads the progress events the route wrote (and asserts the
  // answer carries no log events: TASK-005 moved the run text to the hub).
  function ndjsonEvents(
    chunks: string[],
  ): Array<{ log?: string; progress?: Record<string, unknown> }> {
    return chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { log?: string; progress?: Record<string, unknown> })
  }

  function getRouteWith(host: LifecycleHost | undefined, service: LocalInferService = stubService([])) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
      host,
    )
    return routes.find((route) => route.path === '/local-infer/get')!
  }

  function fakePost(body: string) {
    return {
      method: 'POST',
      url: '/local-infer/get',
      destroy(): void {
        /* the handler only destroys on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        yield Buffer.from(body)
      },
    }
  }

  it('clones the upstream repo into the engine cache home when no override is set', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: {} },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The default checkout home is ~/.cache/dsh/infer/<engine-id>, never a
    // subfolder of the model directory.
    expect(logged).toContain(`$ git clone https://github.com/Neroued/ninfer ${dshEngineCacheDirectory('ninfer')}`)
    // The build steps run after the sync, with the checkout path substituted.
    expect(logged).toContain(`cmake -S ${dshEngineCacheDirectory('ninfer')}`)
    expect(logged).toContain('get complete')
  })

  it('uses the Engine Directory override and clones the fork when both are stored', async () => {
    writeConfig('ninfer', {}, true, { ninfer: { engineDirectory: '/src/ninfer', engineFork: 'https://github.com/me/ninfer' } })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: {} },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).toContain('$ git clone https://github.com/me/ninfer /src/ninfer')
    expect(logged).toContain('cmake -S /src/ninfer')
  })

  it('aborts with a Logs alert when the checkout has local changes', async () => {
    writeConfig('ninfer', {}, true)
    const { host, state } = stubGetHost({ stream: { 'status --short': ' M src/engine.c\n' } })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('local changes')
    expect(logged).toContain('has local changes. Get aborted')
    // The abort stops the step: no build runs.
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
  })

  it('re-checks deps with the trust gate off and aborts on a missing dep', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([], { deps: [TEST_DEP] }),
      { engine: 'ninfer', config: { buildMode: 'local' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('a system dependency is missing')
    expect(logged).toContain('  cmake: missing')
    expect(logged).toContain('one-click install is off')
    // The missing dep stops the step before the build.
    expect(logged).not.toContain('cmake -S')
  })

  it('logs per-dep results when the trust gate is on', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([], { deps: [TEST_DEP] }),
      { engine: 'ninfer', config: { buildMode: 'local' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).toContain('system dependencies (local)')
    expect(logged).toContain('  cmake: satisfied')
    expect(logged).toContain('get complete')
  })

  it('persists the run to the last logs and the run-log hub, streaming no log lines itself', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    const service = stubService([])
    const route = getRouteWith(host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    // TASK-005: the Get answer carries progress events only. The run's text
    // reaches the card through the run-log hub (the logs route's source), so
    // one line never lands twice.
    const events = ndjsonEvents(res.chunks)
    expect(events.some((event) => event.log !== undefined)).toBe(false)
    const hubText = service.readRunLog('ninfer').text
    expect(hubText).toContain('$ git clone')
    expect(hubText).toContain('get complete')
    // The run persists as the last logs the Logs section shows, under
    // the "Getting engine and model..." separator the route writes when the
    // Get button is clicked.
    expect(readConfig().lastLogs).toContain('--- Getting engine and model...')
    expect(readConfig().lastLogs).toContain('get complete')
  })

  it('persists and feeds the hub the CLI sudo note when the host announces a waiting sudo', async () => {
    writeConfig('ninfer', {}, true)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    // The stub host plays the guarded node host: the body's sudo build
    // command is announced through the service's notify seam before it runs,
    // the way the real host announces after a credential probe that found
    // nothing cached.
    const host = stubGetHost({
      announceSudo: (command) => service.notifySudoNeeded(command),
    }).host
    const route = getRouteWith(host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(
        JSON.stringify({
          engine: 'ninfer',
          config: { modelDirectory: MODEL_DIR },
          platform: { buildCommands: 'sudo ln -sf ./build/engine /usr/local/bin/engine' },
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const hubText = service.readRunLog('ninfer').text
    // The note lands in the live hub run exactly once, prefixed with the
    // `!!` marker the Get step's own failure lines use.
    expect(hubText).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    expect(hubText.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    // The note persists through persistProcessLog while the run is still
    // hung on the prompt, and the collected run persists with it under the
    // "Getting engine and model..." separator. finishRunSection closes the
    // run over the pre-run baseline, so the provisional mid-run note line
    // and the collected run text persist the note exactly once.
    expect(readConfig().lastLogs).toContain(`!! ${SUDO_CLI_NOTE}`)
    expect(readConfig().lastLogs.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    expect(readConfig().lastLogs).toContain('--- Getting engine and model...')
    // The Get route streams no control-state event and no log lines (Q2):
    // the answer carries only progress events.
    const events = ndjsonEvents(res.chunks)
    expect(events.every((event) => event.progress !== undefined)).toBe(true)
    // The run registered its hook under the draft's key and cleared it when
    // it settled: one live hook at register, none at dispose.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('writes the Get run (commands and output) to the configured log file', async () => {
    writeConfig('ninfer', {}, true)
    // The per-run log name carries a second-resolution timestamp: an earlier
    // test's run in a different second would otherwise sort first under the
    // same ninfer- prefix and be read here. Clear the directory so this
    // run's file is the only ninfer-*.log to find.
    const logDir = join(home, '.dsh', 'local-infer', 'logs')
    rmSync(logDir, { recursive: true, force: true })
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    // The Get step owns a per-run log file too: the commands and their output
    // land in the configured log directory under the "Getting engine and
    // model..." separator.
    const entries = existsSync(logDir) ? readdirSync(logDir) : []
    const logFile = entries.find((name) => name.startsWith('ninfer-') && name.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = readFileSync(join(logDir, logFile!), 'utf8')
    expect(content).toContain('--- Getting engine and model...')
    expect(content).toContain('$ git clone')
    expect(content).toContain('get complete')
  })

  it('persists the streamed output on top of the previous last logs', async () => {
    writeConfig('ninfer', {}, true, undefined, true, [], undefined, 'prior run')
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(fakePost(JSON.stringify({ engine: 'ninfer' })), res)
    expect(readConfig().lastLogs).toContain('prior run')
    expect(readConfig().lastLogs).toContain('get complete')
  })

  it('downloads the DFlash2 drafter and the n-gram volume for an Infernix Get', async () => {
    writeConfig('infernix', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      {
        engine: 'infernix',
        config: {
          spec: 'dflash2',
          model: 'qwen38-flash-next',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The selected DFlash2 drafter downloads into the model directory, the
    // layout the --draft-model path expects, joined with the host separator.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix Qwen3.8-Flash-Next-DFlash2-Infernix.infernix --local-dir ${join(MODEL_DIR, 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix')} --format human`,
    )
    // The Flash-Next model's PLE n-gram volume downloads into the model
    // directory, so the --ngram-volume flag reads a file the same Get left.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram --local-dir ${MODEL_DIR} --format human`,
    )
    expect(logged).toContain('get complete')
  })

  it('routes the Infernix extra-download chunks to the onChunk sink', async () => {
    writeConfig('infernix', {}, true)
    // The stubbed host.runStream hands the fake tqdm line to its chunk
    // callback, the way the real runner streams the hf download's stderr.
    const tqdmLine = '42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'
    const { host } = stubGetHost({
      exists: false,
      stream: {
        'hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix': tqdmLine,
      },
    })
    const chunks: string[] = []
    let logged = ''
    const result = await getEngine(
      stubService([]),
      {
        engine: 'infernix',
        config: {
          spec: 'dflash2',
          model: 'qwen38-flash-next',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.ok).toBe(true)
    // The chunk reaches the onChunk progress sink and the log sink together,
    // so the Infernix extra download feeds the same progress events the
    // model and template downloads do.
    expect(chunks).toEqual([tqdmLine])
    expect(logged).toContain(tqdmLine)
    expect(logged).toContain('get complete')
  })

  it('pulls no model artifacts for a non-Infernix Get', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).not.toContain('hf download')
    expect(logged).toContain('get complete')
  })

  it('hands the hf download raw stderr chunks to the onChunk sink', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const { host } = stubGetHost({ exists: false })
    const service = stubService([])
    // The stubbed download invokes the injected onChunk, the way the real
    // service hands the runner's streamed stderr chunks to it.
    service.downloadModel = (
      _entry: DefaultModel,
      _directory: string,
      options?: { onChunk?: (chunk: string) => void },
    ) => {
      options?.onChunk?.('42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n')
      return Promise.resolve({ ok: true })
    }
    const chunks: string[] = []
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.ok).toBe(true)
    // The raw tqdm line reaches the onChunk sink as it lands, separate from
    // the log text sink.
    expect(chunks).toEqual(['42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'])
    // The step log lines stay on the log sink, unchanged.
    expect(logged).toContain('$ hf download')
    expect(logged).toContain('get complete')
  })

  it('streams a progress event for the download tqdm chunks and keeps the persisted log plain text', async () => {
    // The qwen36-35b model names a log file the cancel test's prefix search
    // (ninfer-qwen3-27b-*) does not match, so the two tests own separate
    // per-run log files.
    writeConfig('ninfer', { model: 'qwen36-35b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    // The stubbed download invokes the injected onChunk with a tqdm line, the
    // way the real runner hands the hf download's streamed stderr to it.
    const tqdmLine = 'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n'
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { onChunk?: (chunk: string) => void }) => {
      options?.onChunk?.(tqdmLine)
      return Promise.resolve({ ok: true })
    }
    const route = getRouteWith(stubGetHost({ exists: false }).host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    const events = ndjsonEvents(res.chunks)
    const progress = events.filter((event) => event.progress !== undefined)
    // The folded tqdm line lands as one progress event with the parsed state
    // the card renders.
    expect(progress).toHaveLength(1)
    expect(progress[0]?.progress).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
    // TASK-005: the answer carries no log lines. The run's plain text
    // reaches the card through the run-log hub (no matching provider entry,
    // so the engine-id key), and the persisted run stays plain text: the log
    // file reads the run, not the NDJSON it streamed.
    expect(events.some((event) => event.log !== undefined)).toBe(false)
    const hubText = service.readRunLog('ninfer').text
    expect(hubText).toContain('$ hf download')
    expect(hubText).toContain('get complete')
    expect(readConfig().lastLogs).toContain('$ hf download')
    expect(readConfig().lastLogs).not.toContain('{"log"')
  })

  it('answers 400 for a broken body and streams nothing', async () => {
    const route = getRouteWith(stubGetHost({ exists: false }).host)
    const res = fakeStreamRes()
    await route.handler(fakePost('{broken'), res)
    expect(res.status).toBe(400)
    expect(res.chunks).toHaveLength(0)
  })

  it('persists the failure note on the run-log hub and the last logs when the run throws', async () => {
    writeConfig('ninfer', {}, true)
    const throwingHost: LifecycleHost = {
      async run(): Promise<{ ok: boolean; detail?: string }> {
        throw new Error('host exploded')
      },
    }
    const service = stubService([])
    const route = getRouteWith(throwingHost, service)
    const res = fakeStreamRes()
    await route.handler(fakePost(JSON.stringify({ engine: 'ninfer' })), res)
    expect(res.status).toBe(200)
    // TASK-005: the failure note no longer rides the answer. The live hub
    // buffer and the persisted last logs carry it for the Logs section.
    expect(res.chunks.join('')).not.toContain('get failed: host exploded')
    expect(service.readRunLog('ninfer').text).toContain('get failed: host exploded')
    expect(readConfig().lastLogs).toContain('get failed: host exploded')
  })

  it('aborts the in-flight download on a client disconnect and persists the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal: the
    // in-flight hf child the cancel interrupts.
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { signal?: AbortSignal }) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const route = getRouteWith(stubGetHost({ exists: false }).host, service)
    const res = fakeStreamRes()
    const pending = route.handler(
      fakePost(
        JSON.stringify({
          engine: 'ninfer',
          config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        }),
      ),
      res,
    )
    // Let the handler reach the hanging download, then the card's provider-form
    // Cancel closes the stream: the route aborts the in-flight download, and
    // the run persists with the "Canceled" line.
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    expect(readConfig().lastLogs).toContain('--- Canceled')
    // The run's own log file (the model slug names it) carries the same line,
    // so a reload reads the run as canceled, not as a fresh "Getting engine
    // and model..." run.
    const logDir = join(home, '.dsh', 'local-infer', 'logs')
    const entries = existsSync(logDir) ? readdirSync(logDir) : []
    const logFile = entries.find(
      (name) => name.startsWith('ninfer-qwen3-27b-') && name.endsWith('.log'),
    )
    expect(logFile).toBeDefined()
    expect(readFileSync(join(logDir, logFile!), 'utf8')).toContain('--- Canceled')
  })
})

describe('shared Get-steps routine', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-get-steps-'))
    pointHomeAt(home)
    // A sibling describe's afterAll removes the shared model directory, so
    // recreate it: the presence-skip tests write artifact files into it.
    mkdirSync(MODEL_DIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('runs all five Get steps in order and streams each through the log', async () => {
    // The model and template artifacts start absent, so the download steps
    // run for this test.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'chat_template.jinja'), { force: true })
    writeConfig(
      'ninfer',
      {
        model: 'qwen3-27b',
        chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
        modelDirectory: MODEL_DIR,
      },
      true,
    )
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const templates: { repo: string; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], {
      deps: [TEST_DEP],
      onDownload: (args) => downloads.push(args),
      onDownloadChatTemplate: (args) => templates.push(args),
    })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      {
        engine: 'ninfer',
        config: {
          model: 'qwen3-27b',
          chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The five steps land in order: the dep install, the clone (its header
    // then the git command), the build (its header then the cmake command),
    // the model download, and the chat-template download.
    const order = [
      'system dependencies (local)',
      '  cmake: satisfied',
      'engine clone: ninfer',
      `$ git clone https://github.com/Neroued/ninfer ${dshEngineCacheDirectory('ninfer')}`,
      'engine build: ninfer',
      `cmake -S ${dshEngineCacheDirectory('ninfer')}`,
      `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir ${MODEL_DIR}`,
      `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir ${MODEL_DIR}`,
    ]
    let last = -1
    for (const line of order) {
      const index = logged.indexOf(line)
      expect(index, `missing "${line}" in the Get log`).toBeGreaterThan(last)
      last = index
    }
    // The downloads run through the service's hf download entry points, into
    // the model directory.
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.directory).toBe(MODEL_DIR)
    expect(templates).toEqual([
      { repo: 'froggeric/Qwen-Fixed-Chat-Templates', directory: MODEL_DIR, useHubCache: false },
    ])
    expect(logged).toContain('get complete')
  })

  it('downloads into the hub-cache layout when the model directory is the default', async () => {
    // No modelDirectory override: the hub-cache layout applies, so the
    // download targets the cache root (no --local-dir) and leaves no duplicate
    // flat dir. (Resume is within-invocation only; a killed run re-downloads.)
    writeConfig('ninfer', { model: 'qwen3-27b' }, true)
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownload: (args) => downloads.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The hub-cache command drops --local-dir, and with nothing cached yet
    // the model directory falls back to the hub cache root read through the
    // service seam (the plugin's model download home), not a flat subdir.
    expect(logged).toContain(
      '$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --format human\n',
    )
    expect(logged).not.toContain('--local-dir')
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.directory).toBe(MODEL_DIR)
    expect(logged).toContain('get complete')
  })

  it('skips the model download when the hub-cache artifact is already cached', async () => {
    // No modelDirectory override and the artifact present in the fake hub
    // cache under the service's model directory: the deterministic snapshot
    // presence check skips the re-fetch, and the layout stays hub-cache (no
    // --local-dir). The directory the steps would name (the hf download
    // result, the snapshot holding the artifact) is displayed by the summary,
    // never persisted into the config.
    const hubRoot = MODEL_DIR
    const snapshot = join(
      hubRoot,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    try {
      writeConfig('ninfer', { model: 'qwen3-27b' }, true)
      const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
      const service = stubService([], { onDownload: (args) => downloads.push(args) })
      const { host } = stubGetHost({ exists: false })
      let logged = ''
      const result = await getEngine(
        service,
        { engine: 'ninfer', config: { model: 'qwen3-27b' } },
        (chunk) => {
          logged += chunk
        },
        host,
      )
      expect(result.ok).toBe(true)
      expect(logged).not.toContain('--local-dir')
      expect(logged).toContain('model download: qwen3-27b is already present, skipped')
      expect(downloads).toHaveLength(0)
    } finally {
      rmSync(join(hubRoot, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('skips the model download when the artifact is already present', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'present')
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownload: (args) => downloads.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The artifact is on disk, so no download runs and the step logs the
    // skip, not a re-fetch.
    expect(downloads).toHaveLength(0)
    expect(logged).toContain('model download: qwen3-27b is already present, skipped')
    expect(logged).not.toContain('hf download neroued')
    expect(logged).toContain('get complete')
  })

  it('skips the chat template download when the template is already present', async () => {
    writeConfig(
      'ninfer',
      {
        model: 'qwen3-27b',
        chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
        modelDirectory: MODEL_DIR,
      },
      true,
    )
    writeFileSync(join(MODEL_DIR, 'chat_template.jinja'), 'present')
    const templates: { repo: string; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownloadChatTemplate: (args) => templates.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      {
        engine: 'ninfer',
        config: {
          model: 'qwen3-27b',
          chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The template file is on disk, so no download runs and the step logs
    // the skip, not a re-fetch.
    expect(templates).toHaveLength(0)
    expect(logged).toContain(
      'chat template: froggeric/Qwen-Fixed-Chat-Templates is already present, skipped',
    )
    expect(logged).toContain('get complete')
  })

  it('skips the sync and build steps when auto rebuild is off', async () => {
    writeConfig('ninfer', {}, true)
    const service = stubService([])
    const { host, state } = stubGetHost({ exists: false })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: {},
        allowRunDeps: true,
        autoRebuild: false,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    // The checkbox off: the checkout launches as-is, so no git sync and no
    // build run.
    expect(logged).toContain('engine sync and build: auto rebuild off, skipped')
    expect(state.streamed.some((command) => command.includes('git'))).toBe(false)
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
  })

  it('aborts a launch when a Get step fails and keeps the Get logs', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const service = stubService([], {
      deps: [TEST_DEP],
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          port: 18020,
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { buildMode: 'local' } },
      undefined,
      stubGetHost({ exists: false }).host,
    )
    // The missing dep aborts the launch before the deploy starts, and the
    // persisted run carries the Get-step output that named the broken step.
    expect(result.healthy).toBe(false)
    expect(result.detail).toBe('a system dependency is missing')
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('  cmake: missing')
    expect(lastLogs).toContain('a system dependency is missing')
    // The get-failed path leaves the result's logs unset, so the persisted
    // run leads with the Get-step output and carries it exactly once.
    expect(lastLogs.match(/a system dependency is missing/g)?.length).toBe(1)
  })

  it('continues with the current version when a rebase fails under the override', async () => {
    // The checkout directory exists (a current version to launch), so a failed
    // rebase is non-fatal under the override: the run reports syncFailed and
    // skips the build, keeping the checkout at its current version.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    const service = stubService([])
    const { host, state } = stubGetHost({ exists: true, fail: ['rebase'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        continueOnSyncFailure: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.syncFailed).toBe(true)
    // The error line and the continue note land in the logs the caller
    // persists to the Logs section and the log file.
    expect(logged).toContain('!! git rebase')
    expect(logged).toContain('engine sync failed; continuing with the current version')
    expect(logged).toContain('get complete')
    // The rebase failed, so the build step is skipped: no cmake command runs.
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('still fails the run when a rebase fails without the override', async () => {
    // The override off (a standalone Get): a failed rebase of an existing
    // checkout stops the run, the existing behavior.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    const service = stubService([])
    const { host } = stubGetHost({ exists: true, fail: ['rebase'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.syncFailed).toBeUndefined()
    expect(result.detail).toContain('git rebase')
    expect(logged).toContain('!! git rebase')
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('keeps a clone failure fatal under the override when no checkout exists', async () => {
    // No checkout directory (a clone failure, no current version to launch):
    // the override does not apply, so the run stays fatal.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
    const service = stubService([])
    const { host } = stubGetHost({ exists: false, fail: ['git clone'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        continueOnSyncFailure: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.syncFailed).toBeUndefined()
    expect(result.detail).toContain('git clone')
    expect(logged).toContain('!! git clone')
  })
})

describe('engine death persistence', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-death-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function providerWithRecord(): StoredProviderConfig {
    return {
      id: 'p1',
      engine: 'infernix',
      config: { port: 18080 },
      platform: {},
      launch: {
        pid: 12345,
        startedAt: '2026-10-23T12:00:00.000Z',
        argv: ['infernix-serve', '--port', '18080'],
        previousPids: [999],
        engineId: 'infernix',
        modelId: 'qwen3-27b',
        port: 18080,
      },
    }
  }

  it('clears the provider record and notes the exit when the engine is killed', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithRecord()],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    handleEngineDeath({
      engineId: 'infernix',
      port: 18080,
      pid: 12345,
      code: null,
      signal: 'SIGKILL',
    })
    const stored = readConfig()
    // The record (with its previous-pid list) is gone, so a restart cannot
    // re-link the recycled pid, and the exit line landed in the last-run logs.
    expect(stored.providers[0]?.launch).toBeUndefined()
    expect(stored.lastLogs).toContain('engine up')
    expect(stored.lastLogs).toContain(
      'engine infernix (port 18080) pid 12345 exited on signal SIGKILL',
    )
  })

  it('matches by engine and port when the death carries no tracked pid', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithRecord()],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    handleEngineDeath({
      engineId: 'infernix',
      port: 18080,
      code: 1,
      signal: null,
      detail: 'the adopted engine process exited outside this DSH session',
    })
    const stored = readConfig()
    expect(stored.providers[0]?.launch).toBeUndefined()
    expect(stored.lastLogs).toContain('exited with exit code 1')
    expect(stored.lastLogs).toContain('outside this DSH session')
  })

  it('stays quiet when no stored entry carries a matching record', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [{ id: 'p2', engine: 'infernix', config: {}, platform: {} }],
      DEFAULT_LOG_PATH_TEMPLATE,
      'keep',
    )
    handleEngineDeath({ engineId: 'infernix', port: 9999, pid: 777, code: null, signal: null })
    // An expected stop (the route already cleared the record) or an untracked
    // engine rewrites nothing: the stored state stays as the stop left it.
    expect(readConfig().lastLogs).toBe('keep')
    expect(readConfig().providers[0]?.launch).toBeUndefined()
  })

  it('mount registers the death observer and dispose clears it', () => {
    let observer: ((event: EngineDeathEvent) => void) | undefined = 'unset' as never
    let dispose: (() => void) | undefined
    const scope = {
      webServer: {
        register: (): (() => void) => () => undefined,
      },
      effect: (fn: () => unknown): void => {
        dispose = fn() as () => void
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      stubService([], {
        onSetDeathObserver: (next): void => {
          observer = next
        },
      }),
    )
    expect(observer).toBeTypeOf('function')
    dispose?.()
    expect(observer).toBeUndefined()
  })

  it('passes the provider config into the status detector', async () => {
    let refs: readonly ProviderRef[] | undefined
    writeConfig('ninfer', {}, false, undefined, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b', port: 18080 }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async (providers) => {
        refs = providers
        return {}
      },
    })
    await buildSummary(service)
    // The config rides into the detector so the signature prices the
    // provider's own port rather than the adapter's default.
    expect(refs?.[0]?.config).toEqual({ model: 'qwen3-27b', port: 18080 })
  })
})

describe('run-log hub wiring', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-hub-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * hubRoutes registers every route over a fake web server and answers the
   * one for a path; getHost feeds the Get route's stub host, launchHost the
   * launch route's.
   */
  function hubRoutes(service: LocalInferService, getHost?: LifecycleHost, launchHost?: LifecycleHost) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
      getHost,
      launchHost,
    )
    return (path: string) => routes.find((route) => route.path === path)!
  }

  function hubRes() {
    const res = {
      status: 0,
      body: '',
      chunks: [] as string[],
      closeListeners: [] as Array<() => void>,
      writeHead(status: number) {
        res.status = status
        return res
      },
      write(chunk: string) {
        res.chunks.push(chunk)
        return true
      },
      end(body?: string) {
        res.body = body ?? ''
        return res
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  function hubPost(path: string, body: Record<string, unknown>) {
    return {
      method: 'POST',
      url: path,
      destroy(): void {
        /* the handlers only destroy on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        yield Buffer.from(JSON.stringify(body))
      },
    }
  }

  /**
   * untilTrue waits on the timer queue until the predicate holds, so a test
   * can wait for a handler to reach its gate without a fixed sleep.
   */
  async function untilTrue(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  function providerWithLaunchRecord(id: string): StoredProviderConfig {
    return {
      id,
      engine: 'infernix',
      config: { model: 'qwen3-27b', port: 18080 },
      platform: {},
      launch: {
        pid: 4242,
        startedAt: '2026-10-23T12:00:00.000Z',
        argv: ['infernix-serve', '--port', '18080'],
        previousPids: [],
        engineId: 'infernix',
        modelId: 'qwen3-27b',
        port: 18080,
      },
    }
  }

  it('brackets the Get run under the matched entry key and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-get',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    // The model artifact starts absent, so the download step's command line
    // lands in the run and names this entry's model.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    const route = hubRoutes(service, stubGetHost({ exists: false }).host)('/local-infer/get')
    const res = hubRes()
    await route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      res,
    )
    // The run key is the stored entry the engine and model match names, and
    // the buffer holds the seed, the Get steps, and the settle line in order.
    const snapshot = service.readRunLog('hub-get')
    expect(snapshot.running).toBe(false)
    expect(snapshot.text.startsWith(GET_RUN_SEED)).toBe(true)
    const cloneAt = snapshot.text.indexOf('$ git clone')
    const downloadAt = snapshot.text.indexOf('Qwen3.8-27B')
    const completeAt = snapshot.text.indexOf('get complete')
    expect(cloneAt).toBeGreaterThan(GET_RUN_SEED.length - 1)
    expect(downloadAt).toBeGreaterThan(cloneAt)
    expect(completeAt).toBeGreaterThan(downloadAt)
    // A draft under the engine-id fallback key stayed untouched.
    expect(service.readRunLog('ninfer')).toEqual({ seq: 0, text: '', running: false })
  })

  it('keeps concurrent runs under different keys from interleaving', async () => {
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-a',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
      {
        id: 'hub-b',
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    const route = hubRoutes(service, stubGetHost({ exists: false }).host)('/local-infer/get')
    await Promise.all([
      route.handler(
        hubPost('/local-infer/get', {
          engine: 'ninfer',
          config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        }),
        hubRes(),
      ),
      route.handler(
        hubPost('/local-infer/get', {
          engine: 'ninfer',
          config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        }),
        hubRes(),
      ),
    ])
    // Each key holds only its own run: one entry's model names never reach
    // the other's buffer, and both settle.
    const a = service.readRunLog('hub-a')
    const b = service.readRunLog('hub-b')
    expect(a.text).toContain('Qwen3.8-27B')
    expect(a.text).not.toContain('Qwen3.6-35B')
    expect(b.text).toContain('Qwen3.6-35B')
    expect(b.text).not.toContain('Qwen3.8-27B')
    expect(a.running).toBe(false)
    expect(b.running).toBe(false)
  })

  it("keeps two concurrent runs' sudo note routing independent: both hear, one settle keeps the other", async () => {
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-sudo-a',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
      {
        id: 'hub-sudo-b',
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    // Gate each run at its model download: both Get runs sit in flight with
    // their sudo hooks registered, so the first run can settle while the
    // second is still open (the case the single observer slot got wrong).
    const gates = new Map<string, () => void>()
    service.downloadModel = (entry) =>
      new Promise<DownloadResult>((resolve) => {
        gates.set(entry.modelId, () => resolve({ ok: true }))
      })
    const route = hubRoutes(service, stubGetHost({ exists: true }).host)('/local-infer/get')
    const settleA = route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      hubRes(),
    )
    await untilTrue(() => gates.has('qwen3-27b'))
    const settleB = route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
      }),
      hubRes(),
    )
    await untilTrue(() => gates.has('qwen36-35b'))
    const command = 'sudo ln -sf ./build/engine /usr/local/bin/engine'
    service.notifySudoNeeded(command)
    // The shared CLI password wait notes both runs: each key's live buffer
    // carries its own `!!` note line.
    expect(service.readRunLog('hub-sudo-a').text).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    expect(service.readRunLog('hub-sudo-b').text).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    // Settle run A only: run B keeps its hook slot (the first settle no
    // longer clears another run's note routing).
    gates.get('qwen3-27b')?.()
    await settleA
    service.notifySudoNeeded(command)
    expect(service.readRunLog('hub-sudo-a').text.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    expect(service.readRunLog('hub-sudo-b').text.split(SUDO_CLI_NOTE).length - 1).toBe(2)
    gates.get('qwen36-35b')?.()
    await settleB
    expect(service.readRunLog('hub-sudo-a').running).toBe(false)
    expect(service.readRunLog('hub-sudo-b').running).toBe(false)
  })

  it('brackets the launch run with the seed, Get steps, command note, build, and engine output in order', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, false, undefined, true, [
      {
        id: 'hub-launch',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      engines: [argvAdapter('ninfer', ['ninfer-serve', '--port', '18080'])],
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        buildLogs: 'build output\n',
        logs: 'engine output\n',
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        providerId: 'hub-launch',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      },
      undefined,
      stubGetHost({ exists: false }).host,
    )
    const snapshot = service.readRunLog('hub-launch')
    expect(snapshot.running).toBe(false)
    const order = [
      LAUNCH_RUN_SEED,
      '$ git clone',
      '[local-infer] launch: ninfer-serve',
      'build output',
      'engine output',
    ].map((needle) => snapshot.text.indexOf(needle))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('settles a canceled launch with the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, false, undefined, true, [
      {
        id: 'hub-cancel',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal.
    service.downloadModel = (
      _entry: DefaultModel,
      _directory: string,
      options?: { signal?: AbortSignal },
    ) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const route = hubRoutes(service, undefined, stubGetHost({ exists: false }).host)(
      '/local-infer/launch',
    )
    const res = hubRes()
    const pending = route.handler(
      hubPost('/local-infer/launch', {
        engine: 'ninfer',
        providerId: 'hub-cancel',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    const snapshot = service.readRunLog('hub-cancel')
    expect(snapshot.text).toContain('Qwen3.8-27B')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the download run with streamed hf chunks and the settle line', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b' }, false, undefined, true, [
      { id: 'hub-dl', engine: 'ninfer', config: { model: 'qwen36-35b' }, platform: {} },
    ])
    const service = stubService([])
    // The stub download plays the hf runner's chunk callback, the way the
    // real runner hands streamed output to the download options.
    service.downloadModel = (
      _entry: DefaultModel,
      _directory: string,
      options?: DownloadModelOptions,
    ) => {
      options?.onChunk?.('hf: downloading 42%\n')
      return Promise.resolve({ ok: true })
    }
    const route = hubRoutes(service)('/local-infer/download')
    const res = hubRes()
    await route.handler(
      hubPost('/local-infer/download', {
        engine: 'ninfer',
        model: 'qwen36-35b',
        directory: MODEL_DIR,
      }),
      res,
    )
    expect(res.status).toBe(200)
    const snapshot = service.readRunLog('hub-dl')
    expect(snapshot.text).toBe(`${DOWNLOAD_RUN_SEED}hf: downloading 42%\ndownload complete\n`)
    expect(snapshot.running).toBe(false)
    // The persisted read model keeps its "Downloading..." section unchanged.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('download complete')
  })

  it('notes a failed download in the live run and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b' }, false, undefined, true, [
      { id: 'hub-dl-fail', engine: 'ninfer', config: { model: 'qwen36-35b' }, platform: {} },
    ])
    const service = stubService([], { downloadResult: { ok: false, detail: 'hf exploded' } })
    await downloadFor(service, { engine: 'ninfer', model: 'qwen36-35b', directory: MODEL_DIR })
    const snapshot = service.readRunLog('hub-dl-fail')
    expect(snapshot.text).toBe(`${DOWNLOAD_RUN_SEED}!! download failed: hf exploded\n`)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the chat-template run under the engine-and-model key', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b', chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
      false,
      undefined,
      true,
      [{ id: 'hub-tpl', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} }],
    )
    const service = stubService([])
    service.downloadChatTemplate = (
      _repo: string,
      _directory: string,
      options?: DownloadModelOptions,
    ) => {
      options?.onChunk?.('template fetched\n')
      return Promise.resolve({ ok: true })
    }
    const route = hubRoutes(service)('/local-infer/chat-template')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/chat-template', { directory: MODEL_DIR }), res)
    expect(res.status).toBe(200)
    const snapshot = service.readRunLog('hub-tpl')
    expect(snapshot.text).toBe(`${DOWNLOAD_RUN_SEED}template fetched\n`)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the install run with the per-dep results and settles it', async () => {
    writeConfig('ninfer', {}, true)
    const service = stubService([], { deps: [TEST_DEP] })
    const route = hubRoutes(service)('/local-infer/install')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/install', { engine: 'ninfer' }), res)
    expect(res.status).toBe(200)
    // No provider entry matches the draft, so the key falls back to the
    // engine id, and each re-checked dep lands in the Get step's shape.
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text).toBe(`${INSTALL_RUN_SEED}  cmake: satisfied\n`)
    expect(snapshot.running).toBe(false)
  })

  it('starts no hub run for a refused (409) install', async () => {
    writeConfig('ninfer', {}, false)
    const service = stubService([], { deps: [TEST_DEP] })
    const route = hubRoutes(service)('/local-infer/install')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/install', { engine: 'ninfer' }), res)
    expect(res.status).toBe(409)
    expect(service.readRunLog('ninfer')).toEqual({ seq: 0, text: '', running: false })
  })

  it('brackets the stop run under the provider key', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, undefined, true, [
      { id: 'hub-stop', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    await stopEngine(service, { engine: 'ninfer', providerId: 'hub-stop' })
    const snapshot = service.readRunLog('hub-stop')
    expect(snapshot.text).toBe(STOP_RUN_SEED)
    expect(snapshot.running).toBe(false)
  })

  it('notes a stop failure in the live run and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, undefined, true, [
      { id: 'hub-stop-fail', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    service.stop = async (): Promise<void> => {
      throw new Error('kill failed')
    }
    await expect(
      stopEngine(service, { engine: 'ninfer', providerId: 'hub-stop-fail' }),
    ).rejects.toThrow('kill failed')
    const snapshot = service.readRunLog('hub-stop-fail')
    expect(snapshot.text).toContain(
      '[local-infer] stop failed for ninfer (qwen3-27b): kill failed',
    )
    expect(snapshot.running).toBe(false)
  })

  it('lands a late engine-death note without stranding the key as running', () => {
    const event: EngineDeathEvent = {
      engineId: 'infernix',
      port: 18080,
      pid: 4242,
      code: null,
      signal: 'SIGTERM',
    }
    // An open run: the note joins the live buffer and the running flag
    // stays set (the run owns its own end).
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-death')],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const open = stubService([])
    open.beginRun('hub-death', 'engine up\n')
    handleEngineDeath(event, open)
    const openRun = open.readRunLog('hub-death')
    expect(openRun.text).toContain('engine up\n')
    expect(openRun.text).toContain('pid 4242 exited on signal SIGTERM')
    expect(openRun.running).toBe(true)
    // A settled run: the late append reopens the key, so the death handler
    // settles it again right away.
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-death')],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const settled = stubService([])
    handleEngineDeath(event, settled)
    const lateNote = settled.readRunLog('hub-death')
    expect(lateNote.text).toContain('pid 4242 exited on signal SIGTERM')
    expect(lateNote.running).toBe(false)
    // An event matching no launch record leaves the hub untouched.
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [{ id: 'hub-death', engine: 'infernix', config: { model: 'qwen3-27b', port: 18080 }, platform: {} }],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    const quiet = stubService([])
    handleEngineDeath(event, quiet)
    expect(quiet.readRunLog('hub-death')).toEqual({ seq: 0, text: '', running: false })
  })

  it('wires the mounted death observer through the service hub', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-wired')],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    let observer: ((event: EngineDeathEvent) => void) | undefined
    const service = stubService([], {
      onSetDeathObserver: (next): void => {
        observer = next
      },
    })
    hubRoutes(service)('/local-infer/summary')
    observer?.({ engineId: 'infernix', port: 18080, pid: 4242, code: 1, signal: null })
    // The route's observer closure captured the service, so the note reaches
    // the hub key and the reopened run settles.
    const snapshot = service.readRunLog('hub-wired')
    expect(snapshot.text).toContain('engine infernix (port 18080) pid 4242 exited with exit code 1')
    expect(snapshot.running).toBe(false)
  })
})

describe('logs route (GET /local-infer/logs stream)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-logs-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * logsRouteAt registers every route over a fake web server and answers
   * the logs route's definition.
   */
  function logsRouteAt(service: LocalInferService) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
    return routes.find((route) => route.path === '/local-infer/logs')!
  }

  function logsRes() {
    const res = {
      status: 0,
      ended: false,
      headers: {} as Record<string, string>,
      chunks: [] as string[],
      closeListeners: [] as Array<() => void>,
      writeHead(status: number, headers?: Record<string, string>) {
        res.status = status
        Object.assign(res.headers, headers ?? {})
        return res
      },
      write(chunk: string) {
        res.chunks.push(chunk)
        return true
      },
      end() {
        res.ended = true
        return res
      },
      // The logs route watches the response's client disconnect to dispose
      // its hub subscription; the fake captures the listener so a test
      // simulates the card's pane closing the stream.
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  function fakeGet(url: string) {
    return {
      method: 'GET',
      url,
      destroy(): void {
        /* a GET request carries no body to destroy */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {},
    }
  }

  // logsEvents parses the logs route's NDJSON chunks into events, so a test
  // reads the snapshot, runBegin, log, and runEnd lines in stream order.
  function logsEvents(chunks: string[]): Record<string, unknown>[] {
    return chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('writes the catch-up snapshot first and follows appends and the run end', async () => {
    const service = stubService([])
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=pane'), res)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    // A key that never ran streams the empty snapshot and stays attached.
    expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
    // A new run reaches the attached reader as a runBegin line, the appends
    // as log lines continuing the seq, and the settle as a runEnd line.
    service.beginRun('pane', '--- Launching...\n')
    service.appendRunLog('pane', 'engine up\n')
    service.appendRunLog('pane', 'healthy\n')
    service.endRun('pane')
    expect(logsEvents(res.chunks).slice(1)).toEqual([
      { runBegin: '--- Launching...\n', seq: 0 },
      { log: 'engine up\n', seq: 1 },
      { log: 'healthy\n', seq: 2 },
      { runEnd: true, seq: 2 },
    ])
  })

  it('catches a late reader up with the buffered text, the seq, and the running flag', async () => {
    const service = stubService([])
    service.beginRun('late', '--- Launching...\n')
    service.appendRunLog('late', 'step one\n')
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=late'), res)
    // The snapshot carries everything the pane missed, with the running flag.
    expect(logsEvents(res.chunks)).toEqual([
      { snapshot: '--- Launching...\nstep one\n', seq: 1, running: true },
    ])
    // Live appends continue the snapshot's seq.
    service.appendRunLog('late', 'step two\n')
    service.endRun('late')
    expect(logsEvents(res.chunks).slice(1)).toEqual([
      { log: 'step two\n', seq: 2 },
      { runEnd: true, seq: 2 },
    ])
  })

  it('does not duplicate an append that lands between subscribe and the snapshot read', async () => {
    const service = stubService([])
    service.beginRun('race', 'seed\n')
    service.appendRunLog('race', 'first\n')
    const read = service.readRunLog.bind(service)
    // The raced append: it lands after the route subscribed but before the
    // route read the snapshot, so its text is already inside the snapshot.
    service.readRunLog = (key: string) => {
      service.appendRunLog(key, 'raced\n')
      return read(key)
    }
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=race'), res)
    const events = logsEvents(res.chunks)
    // The snapshot stays the stream's first line and already holds the raced
    // chunk.
    expect(events[0]).toEqual({
      snapshot: 'seed\nfirst\nraced\n',
      seq: 2,
      running: true,
    })
    // The raced append never streams a second time...
    expect(events.filter((event) => event.log === 'raced\n')).toEqual([])
    // ...and a later append still streams above the dedup watermark.
    service.appendRunLog('race', 'after\n')
    expect(logsEvents(res.chunks).at(-1)).toEqual({ log: 'after\n', seq: 3 })
  })

  it('disposes the hub subscription when the client disconnects', async () => {
    const service = stubService([])
    let disposed = false
    const subscribe = service.subscribeRunLog.bind(service)
    service.subscribeRunLog = (key: string, listener: RunLogListener): (() => void) => {
      const dispose = subscribe(key, listener)
      return () => {
        disposed = true
        dispose()
      }
    }
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=gone'), res)
    expect(res.closeListeners).toHaveLength(1)
    // The card's pane closing fires the node 'close'.
    res.closeListeners[0]!()
    expect(disposed).toBe(true)
    // The dead connection stops receiving hub events.
    service.beginRun('gone', 'seed\n')
    expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
  })

  it('closes open stream connections when the route effect disposes', async () => {
    const service = stubService([])
    // A bundle switch off runs the route effect's disposer: it must detach
    // the streams still open, so no hub listener outlives the registration.
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    let disposeEffect: (() => void) | undefined
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
        },
      },
      effect(fn: () => unknown): void {
        disposeEffect = fn() as (() => void) | undefined
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    const route = routes.find((entry) => entry.path === '/local-infer/logs')!
    service.beginRun('card-live', '--- Launching...\n')
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=card-live'), res)
    service.appendRunLog('card-live', 'live line\n')
    const streamed = res.chunks.length
    expect(logsEvents(res.chunks).at(-1)).toEqual({ log: 'live line\n', seq: 1 })
    disposeEffect?.()
    // The still-open connection is ended on the wire...
    expect(res.ended).toBe(true)
    // ...and detached from the hub: later run events reach nothing.
    service.appendRunLog('card-live', 'after dispose\n')
    service.beginRun('card-live', '--- Launching...\n')
    expect(res.chunks).toHaveLength(streamed)
  })

  it('streams the empty snapshot and stays attached for a blank or unknown key', async () => {
    const service = stubService([])
    const route = logsRouteAt(service)
    // The missing provider param is the blank key; both keys stream an open
    // empty stream rather than a 404.
    const cases = [
      ['/local-infer/logs', ''],
      ['/local-infer/logs?provider=never-ran', 'never-ran'],
    ] as const
    for (const [url, key] of cases) {
      const res = logsRes()
      await route.handler(fakeGet(url), res)
      expect(res.status).toBe(200)
      expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
      // Still attached: a run that starts later reaches this connection.
      service.beginRun(key, 'late start\n')
      expect(logsEvents(res.chunks).at(-1)).toEqual({ runBegin: 'late start\n', seq: 0 })
    }
  })
})
