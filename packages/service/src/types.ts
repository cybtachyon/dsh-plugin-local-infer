import type {
  CommandOutcome,
  Config,
  DefaultModel,
  ModelDirectoryEntry,
  EngineAdapter,
  EngineDepPlan,
  EnginePlatformConfig,
  Guideline,
  GuidelineResult,
  GpuUsageProbe,
  HardwareProfile,
  InstallResult,
  LaunchPlan,
  ModelRow,
  Preset,
  PresetSource,
  ProcessLine,
  ProviderLaunchRecord,
  ProviderRef,
  ProviderStatus,
  ReLinkOutcome,
  RegisterResult,
  ReserveResolution,
  ReserveSource,
  ResolvedDefaults,
  SettingsOp,
  SystemDep,
  VramBreakdown,
  VramModel,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'

/**
 * EstimateResult is the answer to an estimate call: the full VRAM breakdown,
 * the one-word verdict the meter renders, the source the numbers came from,
 * so the meter labels measured versus estimated, and the source the OS
 * reserve in the breakdown came from, so the meter's reserve readout names
 * the 3 GiB default, a config value, a foreign engine, or the GPU-usage
 * fallback.
 */
export interface EstimateResult {
  breakdown: VramBreakdown
  verdict: VramVerdict
  source: 'measured' | 'estimated' | 'not-measured'
  reserveSource: ReserveSource
}

/**
 * DetectOsReserveOptions tunes the OS-reserve detection: engineId names the
 * engine the config prices (the plugin-launched check runs against it), and
 * gpuUsage / processes inject the probe results, so a test prices a busy card
 * or a foreign engine without a live nvidia-smi or ps. An absent probe result
 * runs the live probe; a present one (including an explicit null GPU reading)
 * is used as given.
 */
export interface DetectOsReserveOptions {
  engineId?: string
  gpuUsage?: GpuUsageProbe | null
  processes?: ProcessLine[]
}

/**
 * ProviderStatusOptions tunes the provider-status detection: processes and
 * gpuUsage inject the probe results, so a test prices a busy card or a foreign
 * engine without a live nvidia-smi or ps. An absent probe result runs the live
 * probe; a present one (including an explicit null GPU reading) is used as
 * given.
 */
export interface ProviderStatusOptions {
  processes?: ProcessLine[]
  gpuUsage?: GpuUsageProbe | null
}

/**
 * LaunchResult is the answer to a launch call: the plan that was started,
 * whether the health check passed, a detail for the UI, and the engine's
 * captured log output (stdout and stderr) when the deploy step read it. The
 * route persists the logs as the last run and writes them to the configured
 * log file, so the card's Logs section shows the run even after a reload.
 * `pid` is the engine process the deploy step started (absent when the
 * deploy pulls an image only), and `parentPid` is the DSH process pid that
 * launched the engine (absent when the host process did not identify as
 * DSH), the two fields the route persists as the provider entry's launch
 * record for the restart re-link.
 */
export interface LaunchResult {
  plan: LaunchPlan
  healthy: boolean
  detail?: string
  logs?: string
  pid?: number
  parentPid?: number
}

/**
 * LaunchOptions tunes the launch health poll: the interval between attempts
 * and the attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through; an absent option keeps the adapter's default.
 */
export interface LaunchOptions {
  pollMs?: number
  maxAttempts?: number
}

/**
 * RegisterModelOptions tunes the model registration: agentDefault points the
 * agent default model at the registered provider and model, so a new agent
 * session starts from the local engine.
 */
export interface RegisterModelOptions {
  agentDefault?: boolean
}

/**
 * FetchPresetResult is the answer to a mod-search preset fetch: the tagged
 * preset when the bridge fetched and extracted it, a storage flag, and a
 * degraded flag that is set when the bridge was unavailable and the caller
 * should fall back to the built-in presets.
 */
export interface FetchPresetResult {
  preset: Preset | undefined
  stored: boolean
  degraded: boolean
  detail?: string
}

/**
 * FetchPresetOptions tunes the mod-search fetch: cliPath overrides where the
 * modsearch CLI is resolved from, so a test injects a stub and a profile with
 * a non-default install points at its own copy.
 */
export interface FetchPresetOptions {
  cliPath?: string
}

/**
 * HfCliOptions tunes the hf CLI probe: cliPath overrides where the CLI is
 * resolved from, so a test injects a stub and a profile with a non-default
 * install points at its own copy.
 */
export interface HfCliOptions {
  cliPath?: string
}

/**
 * DownloadResult is the answer to a model download: ok, or a detail naming
 * the broken step the card shows beside its Download button.
 */
export interface DownloadResult {
  ok: boolean
  detail?: string
}

/**
 * DownloadModelOptions tunes the model download: runner injects the command
 * runner, so a test captures the rendered hf CLI command without a live hf.
 */
export interface DownloadModelOptions {
  runner?: (command: string) => Promise<CommandOutcome>
}

/**
 * SettingsNamespaceDescriptor is the structural view of one profile plugin
 * entry the registrar reads: its namespace key, the resolved section value,
 * and the revision the write hands back as the conflict guard.
 */
export interface SettingsNamespaceDescriptor {
  ns: string
  revision: number
  value: unknown
}

/**
 * SettingsDescribeResult is the structural view of the dsh settings service's
 * describe answer: whether the section is writable, whether a document exists,
 * and the redacted namespace views the registrar reads and writes through.
 */
export interface SettingsDescribeResult {
  writable: boolean
  hasDocument: boolean
  namespaces: readonly SettingsNamespaceDescriptor[]
}

/**
 * SettingsRemoteResponse is the typert remote envelope every settings
 * namespace method answers with: a business `value` on `ok`, or a `message`
 * on a refusal. The typert protocol wraps the controller's plain answer in
 * this shape, so the registrar must unwrap `value` before reading it.
 */
export interface SettingsRemoteResponse<T> {
  ok: boolean
  value?: T
  error?: { message: string }
}

/**
 * SettingsForms is the structural view of the dsh settings service the
 * registrar writes through (the same seam the Web UI's settings controller
 * exposes, reached through the typert remote `settings` namespace): describe
 * reads the redacted namespace views, and mutate applies path-addressed edits
 * with a revision guard, so a stale write is refused rather than overwriting a
 * concurrent change. The service package stays free of a dsh-settings import,
 * so the seam is declared structurally here.
 */
/**
 * SettingsDescribeAnswer is the settings describe answer in any of the three
 * contracts the registrar reaches: the { ok, value } typert remote envelope the
 * current host answers with, the plain SettingsDescribeResult a host that
 * predates the envelope answers with, and the bare descriptor array the
 * SettingsForms service the reflect fallback reaches answers with. The
 * registrar reads all three, so it works against any seam.
 */
export type SettingsDescribeAnswer =
  | SettingsRemoteResponse<SettingsDescribeResult>
  | SettingsDescribeResult
  | readonly SettingsNamespaceDescriptor[]

export interface SettingsForms {
  describe(options?: { redactSecrets?: boolean }): Promise<SettingsDescribeAnswer>
  mutate(
    ns: string,
    ops: readonly SettingsOp[],
    expectedRevision?: number,
  ): Promise<SettingsRemoteResponse<unknown> | undefined>
}

/**
 * LocalInferService is the surface the service publishes on ctx.localInfer.
 * Providers register engines, presets, and guidelines against the registries;
 * consumers (the tool package, the UI) call the orchestration entry points.
 * The registries are order-independent: selection never depends on
 * registration order, and a duplicate id is a loud conflict.
 */
export interface LocalInferService {
  registerEngine(adapter: EngineAdapter): () => void
  registerPreset(preset: Preset): () => void
  registerGuideline(guideline: Guideline): () => void
  registerVramModel(model: VramModel): () => void
  registerDepPlan(engineId: string, plan: EngineDepPlan): () => void
  registerEnginePlatformConfig(config: EnginePlatformConfig): () => void

  registeredEngines(): readonly EngineAdapter[]
  registeredPresets(): readonly Preset[]
  registeredGuidelines(): readonly Guideline[]
  registeredVramModels(): readonly VramModel[]
  registeredDepPlans(): ReadonlyMap<string, EngineDepPlan>
  enginePlatformConfig(engineId: string): EnginePlatformConfig | undefined
  launchedEngineIds(): readonly string[]

  estimate(config: Config, hw: HardwareProfile, engineId?: string): Promise<EstimateResult>
  detectHardware(): Promise<HardwareProfile>
  detectOsReserve(config?: Config, options?: DetectOsReserveOptions): Promise<ReserveResolution>
  providerStatuses(
    providers: readonly ProviderRef[],
    options?: ProviderStatusOptions,
  ): Promise<Record<string, ProviderStatus>>
  unsureBannerKillCommands(
    options?: { processes?: ProcessLine[]; gpuUsage?: GpuUsageProbe | null },
  ): Promise<string[]>
  guidelines(config: Config, hw: HardwareProfile, engineId?: string): Promise<GuidelineResult[]>
  deps(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<readonly SystemDep[]>
  installString(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<string>
  runInstall(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<InstallResult>
  launch(plan: LaunchPlan, options?: LaunchOptions): Promise<LaunchResult>
  stop(plan: LaunchPlan): Promise<void>
  reLinkProviders(
    entries: readonly { id: string; record: ProviderLaunchRecord }[],
    options?: {
      processAlive?: (pid: number) => boolean
      commandLine?: (pid: number) => string | undefined
    },
  ): Promise<Record<string, ReLinkOutcome>>
  registerModel(
    plan: LaunchPlan,
    model: ModelRow,
    options?: RegisterModelOptions,
  ): Promise<RegisterResult>
  removeModel(providerId: string, modelId: string): Promise<void>
  resolveDefaults(
    engineId: string,
    modelId: string,
    hw: HardwareProfile,
    explicit?: Config,
  ): Promise<ResolvedDefaults>
  fetchPreset(source: PresetSource, options?: FetchPresetOptions): Promise<FetchPresetResult>
  defaultModelDirectory(): string
  hfCliAvailable(options?: HfCliOptions): Promise<string | null>
  downloadModel(
    entry: DefaultModel,
    directory: string,
    options?: DownloadModelOptions,
  ): Promise<DownloadResult>
  // The chat template download: pulls the template file for one HF repo
  // reference into the model directory, so a selected template works out of
  // the box. Shares the model download's runner and timeout.
  downloadChatTemplate(
    repo: string,
    directory: string,
    options?: DownloadModelOptions,
  ): Promise<DownloadResult>
  // Whether a provider entry with the named model is already registered in the
  // DSH settings, so the save route can sync the registered model's input
  // types without duplicating a fresh registration.
  modelIsRegistered(providerId: string, modelId: string): Promise<boolean>
  listModelDirectory(directory: string): ModelDirectoryEntry[]
}
