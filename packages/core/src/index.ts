/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module dsh-plugin-local-infer/core
 */

export type { Config, CustomArg } from './config.ts'
export {
  detectHardware,
  parseNvidiaSmiGpu,
} from './hardware.ts'
export type {
  GpuProfile,
  GpuProbe,
  HardwareProfile,
  HardwareProbes,
} from './hardware.ts'
export type {
  ComboOption,
  ConstraintResult,
  EnumOption,
  ParameterDeploy,
  ParameterForm,
  ParameterSpec,
} from './parameter.ts'
export {
  DEFAULT_OS_RESERVE_MIB,
  estimateVram,
  KV_PAGE_TOKENS,
  pageRoundUp,
  TIGHT_HEADROOM_BYTES,
} from './estimator.ts'
export type {
  EstimateContext,
  EstimateOptions,
  SpeculationTerms,
  VramBreakdown,
  VramContribution,
  VramEstimate,
  VramModel,
  VramVerdict,
} from './estimator.ts'
export {
  GPU_USAGE_BUSY_THRESHOLD,
  matchLaunchSignature,
  parseNvidiaSmiGpuUsage,
  resolveOsReserve,
} from './reserve.ts'
export {
  commandMatchesArgv,
  launchRecordFromPlan,
  reLinkRecord,
} from './launch-record.ts'
export { formatLaunchCommand } from './launch-command.ts'
export type {
  ProviderLaunchRecord,
  ReLinkInput,
  ReLinkOutcome,
} from './launch-record.ts'
export type {
  EngineLaunchSignature,
  GpuUsageProbe,
  ProcessLine,
  ReserveResolution,
  ReserveSource,
} from './reserve.ts'
export {
  computeProviderStatuses,
  isGpuBusy,
} from './status.ts'
export type {
  ProviderRef,
  ProviderStatus,
  ProviderStatusInput,
  RunningEngineRef,
} from './status.ts'
export {
  DEFAULT_LOG_PATH_TEMPLATE,
  LOG_FILE_NAME_TEMPLATE,
  LOG_TAIL_BYTES,
  LOG_TEMPLATE_ENGINE,
  LOG_TEMPLATE_HOME,
  LOG_TEMPLATE_MODEL,
  LOG_TEMPLATE_TIMESTAMP,
  formatLogTimestamp,
  resolveLogPath,
  slugifyModelName,
} from './logs.ts'
export {
  COMMAND_LOG_PREFIX,
  EngineAdapter,
  LAUNCH_STEPS,
  URL_LOG_PREFIX,
  commandLogLine,
  urlLogLine,
} from './adapter.ts'
export type {
  BuildMode,
  CommandLogger,
  DeployOptions,
  DeployResult,
  EngineLaunchState,
  EnginePlatformConfig,
  FetchResult,
  HealthCheckOptions,
  HealthResult,
  LaunchPlan,
  LaunchProgress,
  LaunchStep,
  LifecycleHost,
  ProcessExitInfo,
  ProcessHandle,
  RunOptions,
} from './adapter.ts'
export {
  NOOP_DEBUG_LOGGER,
  createCommandDebugLogger,
  isHarnessLogDebug,
} from './debug.ts'
export type {
  CreateCommandDebugLoggerArgs,
  DebugLogger,
} from './debug.ts'
export { constraintId, evaluateGuidelines, modelGuidelines } from './guideline.ts'
export type { Guideline, GuidelineLevel, GuidelineResult } from './guideline.ts'
export {
  hardwareClass,
  presetFromFetch,
  resolveDefaults,
  WILDCARD_HARDWARE_CLASS,
} from './defaults.ts'
export type {
  DefaultProvenance,
  DefaultsResolver,
  HardwareClass,
  Preset,
  PresetSource,
  ResolvedDefaults,
} from './defaults.ts'
export {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  agentDefaultOps,
  agentDefaultPointsAt,
  agentDefaultUnsetOps,
  apiKeyEnvFor,
  buildModelEntry,
  defaultApiKeyFor,
  LLM_PI_AI_NAMESPACE,
  modelRowsFrom,
  modelSlug,
  providerIdFor,
  providerRegistrationOps,
  providerRemovalOps,
  removeModelRow,
  upsertModelRow,
} from './registrar.ts'
export type {
  DshModelEntry,
  DshModelRegistrar,
  ModelRow,
  RegisterResult,
  SettingsOp,
} from './registrar.ts'
export {
  checkDeps,
  detectPackageManager,
  osLabel,
  planDeps,
  renderInstallString,
  runInstall,
} from './deps.ts'
export {
  guardSudoCommand,
  sudoFailureDetail,
  SUDO_CLI_NOTE,
  SUDO_PASSWORD_TIMEOUT_MS,
  SUDO_PROBE_COMMAND,
} from './sudo.ts'
export type { SudoGuard, SudoGuardOptions, SudoTimer } from './sudo.ts'
export {
  CHAT_TEMPLATE_FILE,
  chatTemplateArtifactPath,
  chatTemplatePresent,
  hfChatTemplateCommand,
  hfDownloadCommand,
  hfDownloadFileCommand,
  hubCacheModelDirectory,
  hubCacheSnapshotFilePath,
  isModelDirectoryOverridden,
  modelArtifactPath,
  modelArtifactPresent,
  modelCacheEntriesForEngine,
  modelEntriesForEngine,
  repoIdFromUrl,
  repoNameFromUrl,
} from './models.ts'
export type {
  DefaultModel,
  ModelCacheEntry,
  ModelDirectoryEntry,
  ModelDownloadSource,
} from './models.ts'
export {
  hfDatasetsCacheDirectory,
  hfHubCacheDirectory,
  modelDownloadTarget,
  resolveModelDirectory,
} from './hf-cache.ts'
export type { ModelDirectoryResolution, ModelDownloadTarget } from './hf-cache.ts'
export {
  dshConfigCacheDirectory,
  dshEngineCacheDirectory,
  dshInferCacheDirectory,
  hfDownloadResultDirectory,
} from './infer-cache.ts'
export { foldHfProgressChunk, parseHfProgressLine } from './progress.ts'
export type { HfProgress } from './progress.ts'
export type {
  CommandOutcome,
  CommandRunner,
  DepCheck,
  DepStatus,
  EngineDepPlan,
  InstallCommands,
  InstallResult,
  PackageManager,
  PackageManagerProbes,
  SystemDep,
  SystemDepProvisioner,
} from './deps.ts'
