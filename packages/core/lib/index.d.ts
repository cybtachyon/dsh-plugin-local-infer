/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module dsh-plugin-local-infer/core
 */
export type { Config, CustomArg } from './config.ts';
export { detectHardware, parseNvidiaSmiGpu, } from './hardware.ts';
export type { GpuProfile, GpuProbe, HardwareProfile, HardwareProbes, } from './hardware.ts';
export type { ComboOption, ConstraintResult, EnumOption, ParameterForm, ParameterSpec, } from './parameter.ts';
export { DEFAULT_OS_RESERVE_MIB, estimateVram, KV_PAGE_TOKENS, pageRoundUp, TIGHT_HEADROOM_BYTES, } from './estimator.ts';
export type { EstimateContext, EstimateOptions, SpeculationTerms, VramBreakdown, VramContribution, VramEstimate, VramModel, VramVerdict, } from './estimator.ts';
export { GPU_USAGE_BUSY_THRESHOLD, matchLaunchSignature, parseNvidiaSmiGpuUsage, resolveOsReserve, } from './reserve.ts';
export { commandMatchesArgv, launchRecordFromPlan, reLinkRecord, } from './launch-record.ts';
export { formatLaunchCommand } from './launch-command.ts';
export type { ProviderLaunchRecord, ReLinkInput, ReLinkOutcome, } from './launch-record.ts';
export type { EngineLaunchSignature, GpuUsageProbe, ProcessLine, ReserveResolution, ReserveSource, } from './reserve.ts';
export { computeProviderStatuses, isGpuBusy, } from './status.ts';
export type { ProviderRef, ProviderStatus, ProviderStatusInput, RunningEngineRef, } from './status.ts';
export { DEFAULT_LOG_PATH_TEMPLATE, LOG_FILE_NAME_TEMPLATE, LOG_TEMPLATE_ENGINE, LOG_TEMPLATE_HOME, LOG_TEMPLATE_MODEL, LOG_TEMPLATE_TIMESTAMP, formatLogTimestamp, resolveLogPath, slugifyModelName, } from './logs.ts';
export { EngineAdapter } from './adapter.ts';
export type { BuildMode, DeployOptions, DeployResult, EngineLaunchState, EnginePlatformConfig, FetchResult, HealthCheckOptions, HealthResult, LaunchPlan, LaunchProgress, LaunchStep, LifecycleHost, ProcessExitInfo, ProcessHandle, } from './adapter.ts';
export { NOOP_DEBUG_LOGGER, createCommandDebugLogger, isHarnessLogDebug, } from './debug.ts';
export type { CreateCommandDebugLoggerArgs, DebugLogger, } from './debug.ts';
export { constraintId, evaluateGuidelines, modelGuidelines } from './guideline.ts';
export type { Guideline, GuidelineLevel, GuidelineResult } from './guideline.ts';
export { hardwareClass, presetFromFetch, resolveDefaults, WILDCARD_HARDWARE_CLASS, } from './defaults.ts';
export type { DefaultProvenance, DefaultsResolver, HardwareClass, Preset, PresetSource, ResolvedDefaults, } from './defaults.ts';
export { AGENT_DEFAULT_MODEL_NAMESPACE, agentDefaultOps, agentDefaultPointsAt, agentDefaultUnsetOps, apiKeyEnvFor, buildModelEntry, defaultApiKeyFor, LLM_PI_AI_NAMESPACE, modelRowsFrom, modelSlug, providerIdFor, providerRegistrationOps, providerRemovalOps, removeModelRow, upsertModelRow, } from './registrar.ts';
export type { DshModelEntry, DshModelRegistrar, ModelRow, RegisterResult, SettingsOp, } from './registrar.ts';
export { checkDeps, detectPackageManager, osLabel, planDeps, planDepsForOs, renderInstallString, runInstall, } from './deps.ts';
export { CHAT_TEMPLATE_FILE, hfChatTemplateCommand, hfDownloadCommand, modelArtifactPath, modelEntriesForEngine, repoIdFromUrl, repoNameFromUrl, } from './models.ts';
export type { DefaultModel, ModelDirectoryEntry } from './models.ts';
export type { CommandOutcome, CommandRunner, DepCheck, DepStatus, EngineDepPlan, InstallCommands, InstallResult, PackageManager, PackageManagerProbes, SystemDep, SystemDepProvisioner, } from './deps.ts';
//# sourceMappingURL=index.d.ts.map