import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { DEFAULT_LOG_PATH_TEMPLATE, providerIdFor, resolveLogPath } from 'dsh-plugin-local-infer/core'
import { LocalInfer } from 'dsh-plugin-local-infer/service'
import type {
  DownloadResult,
  EngineDeathEvent,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
} from 'dsh-plugin-local-infer/service'
import { apply as applyProviders } from 'dsh-plugin-local-infer/providers'
import { localInferConfigPath, readConfig, writeConfig } from '../src/config.ts'
import { getEngine, handleEngineDeath, launchEngine, stopEngine } from '../src/ops/engine.ts'
import { downloadFor } from '../src/ops/hf.ts'
import { registerFor, resolveContextWindow, unregisterFor } from '../src/ops/model.ts'
import { registerLocalInferRoute, RouteError } from '../src/route.ts'
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
    onDownload?: (args: { entry: DefaultModel; directory: string }) => void
    downloadResult?: DownloadResult
    onDownloadChatTemplate?: (args: { repo: string; directory: string }) => void
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
    downloadChatTemplate: async (repo: string, directory: string) => {
      extras.onDownloadChatTemplate?.({ repo, directory })
      return extras.chatTemplateDownloadResult ?? { ok: true }
    },
    modelIsRegistered: async () => extras.modelIsRegisteredResult ?? false,
    listModelDirectory: () => extras.modelEntries ?? [],
    setEngineDeathObserver: (
      observer: ((event: EngineDeathEvent) => void) | undefined,
    ): void => {
      extras.onSetDeathObserver?.(observer)
    },
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
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020 } }, (step) => {
      steps.push(step)
    })
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
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020 } }, (step) => {
      steps.push(step)
    })
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
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020 }, autoRebuild: false })
    expect(seenOptions?.autoRebuild).toBe(false)
    // The flag absent: the route omits the key, so the deploy step runs the
    // rebuild.
    seenOptions = undefined
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020 } })
    expect(seenOptions?.autoRebuild).toBeUndefined()
  })

  it('persists the launch logs as the last run and writes the log file', async () => {
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\nlistening on 18020',
      },
    })
    await launchEngine(service, { engine: 'ninfer', config: { port: 18020, model: 'qwen3-8-27b' } })
    // The last run is persisted under the "Launching..." separator, so the
    // card's Logs section shows it after a reload, and the resolved log file
    // carries the same output.
    expect(readConfig().lastLogs).toBe('--- Launching...\nengine booted\nlistening on 18020')
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
    const result = await launchEngine(service, { engine: 'infernix', config: {} })
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The command line leads the result logs the route hands the card, and the
    // persisted last run carries it under the "Launching..." separator, so the
    // Logs section diagnoses the exact child process.
    expect(result.logs).toBe(`${note}engine booted`)
    expect(readConfig().lastLogs).toBe(`--- Launching...\n${note}engine booted`)
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
    const result = await launchEngine(service, { engine: 'infernix', config: {} })
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The build output leads, the launch command follows it, and the engine
    // output comes last.
    expect(result.logs).toBe(`${buildLogs}${note}engine booted`)
    // The buildLogs transport field is folded into logs and cleared.
    expect(result.buildLogs).toBeUndefined()
  })

  it('persists the launch command before the deploy so a hung launch stays readable', async () => {
    const service = stubService([], { engines: [argvAdapter('infernix', ['infernix-serve', '--port', '18080'])] })
    let logsDuringLaunch: string | undefined
    service.launch = async (plan: LaunchPlan): Promise<LaunchResult> => {
      // The route wrote the command line before calling the service, so a
      // reload while the deploy and health poll are in flight still shows it.
      logsDuringLaunch = readConfig().lastLogs
      return { plan, healthy: true }
    }
    await launchEngine(service, { engine: 'infernix', config: {} })
    expect(logsDuringLaunch).toBe('[local-infer] launch: infernix-serve --port 18080\n')
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
    const result = await launchEngine(service, { engine: 'infernix', config: {} })
    // A deploy that produced no engine output still carries the command it
    // tried to run, so the Logs section is never blank on a failed launch. The
    // persisted last run leads with the "Launching..." separator.
    expect(result.logs).toBe('[local-infer] launch: infernix-serve --port 18080\n')
    expect(readConfig().lastLogs).toBe(
      '--- Launching...\n[local-infer] launch: infernix-serve --port 18080\n',
    )
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
    await launchEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
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
    await launchEngine(service, { engine: 'ninfer', config: { model: 'qwen3-27b' } })
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
    await launchEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
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
      '/local-infer/chat-template',
      '/local-infer/get',
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
    expect(removed).toEqual({ providerId: 'ninfer-local-qwen38-27b', modelId: 'Qwen3.8-27B' })
  })

  it('answers 405 for the wrong method on every route', async () => {
    const routes = registeredRoutes(stubService([]))
    for (const route of routes) {
      const res = fakeRes()
      // Each route takes one method; the wrong one is its complement. The
      // save, provider-delete, install, download, chat-template, get,
      // launch, stop, register, and unregister routes take a POST, so a GET
      // is wrong; the summary and deps routes take a GET, so a POST is wrong.
      if (
        route.path === '/local-infer/save' ||
        route.path === '/local-infer/provider-delete' ||
        route.path === '/local-infer/install' ||
        route.path === '/local-infer/download' ||
        route.path === '/local-infer/chat-template' ||
        route.path === '/local-infer/get' ||
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
    const routes = registeredRoutes(service)
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

  it('reads the auto-rebuild flag from the launch body and threads it to the service', async () => {
    let seenAutoRebuild: boolean | undefined
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenAutoRebuild = options?.autoRebuild
      return { plan, healthy: true }
    }
    const routes = registeredRoutes(service)
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

  it('carries the chat-template status for an HF repo reference, null for a local path', async () => {
    const withTemplate = await buildSummary(stubService([], { hfCliPath: '/usr/bin/hf' }), {
      engine: 'ninfer',
      config: { chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
    })
    expect(withTemplate.chatTemplateStatus).toEqual({
      repo: 'froggeric/Qwen-Fixed-Chat-Templates',
      label: 'Froggeric22 (Qwen fixed chat templates)',
      present: false,
      hfCli: true,
      downloadCommand: `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir ${MODEL_DIR}`,
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
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * A stub LifecycleHost for the Get steps: `exists` decides whether the
   * `[ -d <dir>/.git ]` probe finds a checkout, `stream` feeds the streamed
   * stdout, and `fail` lists command substrings whose run fails.
   */
  function stubGetHost(options?: { exists?: boolean; stream?: Record<string, string> }) {
    const state = { run: [] as string[], streamed: [] as string[], logged: '' }
    const streamText = (command: string): string => {
      const stream = options?.stream ?? {}
      const key = Object.keys(stream).find((needle) => command.includes(needle))
      return key === undefined ? '' : stream[key]!
    }
    const host: LifecycleHost = {
      async run(command: string) {
        state.run.push(command)
        if (command.startsWith('[ -d')) {
          return options?.exists === false ? { ok: false } : { ok: true }
        }
        return { ok: true }
      },
      async runStream(command: string, onOutput: (chunk: string) => void) {
        state.streamed.push(command)
        const text = streamText(command)
        if (text !== '') {
          onOutput(text)
        }
        return { ok: true }
      },
    }
    return { host, state }
  }

  function fakeStreamRes() {
    const res = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
      chunks: [] as string[],
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
    }
    return res
  }

  function getRouteWith(host: LifecycleHost | undefined) {
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

  it('clones the upstream repo under the model directory when no override is set', async () => {
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
    expect(logged).toContain(`$ git clone https://github.com/Neroued/ninfer ${join(MODEL_DIR, 'ninfer')}`)
    // The build steps run after the sync, with the checkout path substituted.
    expect(logged).toContain(`cmake -S ${join(MODEL_DIR, 'ninfer')}`)
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

  it('streams the run through the route and persists it as the last logs', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    const streamed = res.chunks.join('')
    expect(streamed).toContain('$ git clone')
    expect(streamed).toContain('get complete')
    // The streamed run persists as the last logs the Logs section shows, under
    // the "Getting..." separator the route writes when the Get button is
    // clicked.
    expect(readConfig().lastLogs).toContain('--- Getting...')
    expect(readConfig().lastLogs).toContain('get complete')
  })

  it('writes the Get run (commands and output) to the configured log file', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    // The Get step owns a per-run log file too: the commands and their output
    // land in the configured log directory under the "Getting..." separator.
    const logDir = join(home, '.dsh', 'local-infer', 'logs')
    const entries = existsSync(logDir) ? readdirSync(logDir) : []
    const logFile = entries.find((name) => name.startsWith('ninfer-') && name.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = readFileSync(join(logDir, logFile!), 'utf8')
    expect(content).toContain('--- Getting...')
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
    // layout the --draft-model path expects.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix Qwen3.8-Flash-Next-DFlash2-Infernix.infernix --local-dir ${MODEL_DIR}/Qwen3.8-Flash-Next-DFlash2-Infernix.infernix`,
    )
    // The Flash-Next model's PLE n-gram volume downloads into the model
    // directory, so the --ngram-volume flag reads a file the same Get left.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram --local-dir ${MODEL_DIR}`,
    )
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

  it('answers 400 for a broken body and streams nothing', async () => {
    const route = getRouteWith(stubGetHost({ exists: false }).host)
    const res = fakeStreamRes()
    await route.handler(fakePost('{broken'), res)
    expect(res.status).toBe(400)
    expect(res.chunks).toHaveLength(0)
  })

  it('streams the failure note when the run throws', async () => {
    writeConfig('ninfer', {}, true)
    const throwingHost: LifecycleHost = {
      async run(): Promise<{ ok: boolean; detail?: string }> {
        throw new Error('host exploded')
      },
    }
    const route = getRouteWith(throwingHost)
    const res = fakeStreamRes()
    await route.handler(fakePost(JSON.stringify({ engine: 'ninfer' })), res)
    expect(res.status).toBe(200)
    expect(res.chunks.join('')).toContain('get failed: host exploded')
  })
})

describe('engine death persistence', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-death-'))
    process.env.HOME = home
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
