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
 * LaunchResult is the answer to a launch call: the plan that was started,
 * whether the health check passed, and a detail for the UI.
 */
export interface LaunchResult {
  plan: LaunchPlan
  healthy: boolean
  detail?: string
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
 * SettingsForms is the structural view of the dsh settings service the
 * registrar writes through (the same seam the Web UI's settings controller
 * exposes): describe reads the entries, and mutate applies path-addressed
 * edits with a revision guard, so a stale write is refused rather than
 * overwriting a concurrent change. The service package stays free of a
 * dsh-settings import, so the seam is declared structurally here.
 */
export interface SettingsForms {
  describe(options?: { redactSecrets?: boolean }): readonly SettingsNamespaceDescriptor[]
  mutate(
    ns: string,
    ops: readonly SettingsOp[],
    expectedRevision?: number,
  ): Promise<void>
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
  guidelines(config: Config, hw: HardwareProfile, engineId?: string): Promise<GuidelineResult[]>
  deps(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<readonly SystemDep[]>
  installString(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<string>
  runInstall(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<InstallResult>
  launch(plan: LaunchPlan, options?: LaunchOptions): Promise<LaunchResult>
  stop(plan: LaunchPlan): Promise<void>
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
  listModelDirectory(directory: string): ModelDirectoryEntry[]
}
