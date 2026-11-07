/**
 * The shared fixtures for the /local-infer route spec files (summary, launch,
 * model, handlers, get, logs, deps): the hardware/verdict constants, the fake
 * engine adapters, the stub LocalInferService (a structural literal over the
 * real service RunLogStore so run-log assertions read the same buffers the
 * routes write), the scratch-HOME helper every per-route describe points its
 * config at, and the stub LifecycleHost the Get steps run through.
 * @module dsh-plugin-local-infer/ui/tests/fixtures
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { commandLogLine, hfChatTemplateCommand, hfDownloadCommand } from 'dsh-plugin-local-infer/core'
import { RunLogStore } from 'dsh-plugin-local-infer/service'
import type {
  DownloadModelOptions,
  DownloadResult,
  EngineDeathEvent,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
  RunLogListener,
  RunInstallOptions,
} from 'dsh-plugin-local-infer/service'

export const HW: HardwareProfile = {
  os: 'linux',
  cpuThreads: 8,
  dockerAvailable: true,
  wsl2: false,
  hostRamGiB: 32,
  gpu: { name: 'RTX 3090', vramGiB: 24, sm: 86 },
  packageManager: 'apt',
}

export const BREAKDOWN: VramBreakdown = {
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

export const FITS: VramVerdict = { status: 'fits', detail: 'fits with headroom' }

// A guideline result the banner and the inline map both render from: an
// error anchored to kvDtype, which is the plan's red-warning contract.
export const FIRED: GuidelineResult[] = [
  {
    id: 'vram-exceeds-usable',
    level: 'error',
    message: 'the KV cache exceeds the usable VRAM',
    anchors: ['kvDtype'],
  },
]

export const TEST_DEP: SystemDep = {
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
export function fakeAdapter(
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
export function argvAdapter(id: string, argv: string[]): EngineAdapter {
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

/**
 * composeAdapter stands in for a docker-compose engine (Hyper-Qwen): its
 * plan carries the compose file and profile with no compose arguments, so
 * the launch route's compose up note runs the engine's default profile.
 */
export function composeAdapter(id: string): EngineAdapter {
  return {
    ...fakeAdapter(id),
    renderLaunch: (): LaunchPlan => ({
      engineId: id,
      kind: 'compose',
      env: {},
      composeFile: 'docker-compose.yml',
      profile: 'single',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }),
  } as unknown as EngineAdapter
}

export function stubService(
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
    runInstall: async (_engineId, _buildMode, hw, options?: RunInstallOptions) => {
      // The real service logs each install command's `$ <command>` line to the
      // run's log sink (options.onLog) before the guarded runner spawns the
      // child; the stub replays that so the run reads the command ahead of the
      // per-dep results below.
      for (const dep of extras.deps ?? []) {
        for (const command of dep.install[hw.packageManager ?? '']?.commands ?? []) {
          options?.onLog?.(commandLogLine(command))
        }
      }
      return (
        extras.installResult ?? {
          ok: true,
          results: (extras.deps ?? []).map((dep) => ({ id: dep.id, status: 'satisfied' as const })),
        }
      )
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
      // The real service writes the hf download's `$ <command>` line through
      // options.onLog before its runner spawns; the stub replays it so every
      // download path reads the command line exactly once, as the service does.
      options?.onLog?.(commandLogLine(hfDownloadCommand(entry, directory, options?.useHubCache === true)))
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
      options?.onLog?.(
        commandLogLine(hfChatTemplateCommand(repo, directory, options?.useHubCache === true)),
      )
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
export const MODEL_DIR = mkdtempSync(join(tmpdir(), 'local-infer-models-'))

/**
 * pointHomeAt points os.homedir() at a scratch dir so the config, log, and
 * preset file paths never touch the real home. homedir() reads HOME on POSIX
 * and USERPROFILE on Windows, so both are set and the suite stays portable.
 */
export function pointHomeAt(dir: string): void {
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
export function stubGetHost(
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
