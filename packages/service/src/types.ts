import type {
  Config,
  EngineAdapter,
  EngineDepPlan,
  EnginePlatformConfig,
  Guideline,
  GuidelineResult,
  HardwareProfile,
  InstallResult,
  LaunchPlan,
  ModelRow,
  Preset,
  PresetSource,
  RegisterResult,
  ResolvedDefaults,
  SettingsOp,
  SystemDep,
  VramBreakdown,
  VramModel,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'

/**
 * EstimateResult is the answer to an estimate call: the full VRAM breakdown,
 * the one-word verdict the meter renders, and the source the numbers came
 * from, so the meter labels measured versus estimated.
 */
export interface EstimateResult {
  breakdown: VramBreakdown
  verdict: VramVerdict
  source: 'measured' | 'estimated' | 'not-measured'
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

  estimate(config: Config, hw: HardwareProfile): Promise<EstimateResult>
  detectHardware(): Promise<HardwareProfile>
  guidelines(config: Config, hw: HardwareProfile): Promise<GuidelineResult[]>
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
}
