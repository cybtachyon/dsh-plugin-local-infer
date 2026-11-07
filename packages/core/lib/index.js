/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module dsh-plugin-local-infer/core
 */
export { detectHardware, parseNvidiaSmiGpu, } from "./hardware.js";
export { DEFAULT_OS_RESERVE_MIB, estimateVram, KV_PAGE_TOKENS, pageRoundUp, TIGHT_HEADROOM_BYTES, } from "./estimator.js";
export { GPU_USAGE_BUSY_THRESHOLD, matchLaunchSignature, parseNvidiaSmiGpuUsage, resolveOsReserve, } from "./reserve.js";
export { commandMatchesArgv, launchRecordFromPlan, reLinkRecord, } from "./launch-record.js";
export { formatLaunchCommand } from "./launch-command.js";
export { computeProviderStatuses, isGpuBusy, } from "./status.js";
export { DEFAULT_LOG_PATH_TEMPLATE, LOG_FILE_NAME_TEMPLATE, LOG_TAIL_BYTES, LOG_TEMPLATE_ENGINE, LOG_TEMPLATE_HOME, LOG_TEMPLATE_MODEL, LOG_TEMPLATE_TIMESTAMP, formatLogTimestamp, resolveLogPath, slugifyModelName, } from "./logs.js";
export { COMMAND_LOG_PREFIX, EngineAdapter, LAUNCH_STEPS, URL_LOG_PREFIX, commandLogLine, urlLogLine, } from "./adapter.js";
export { NOOP_DEBUG_LOGGER, createCommandDebugLogger, isHarnessLogDebug, } from "./debug.js";
export { constraintId, evaluateGuidelines, modelGuidelines } from "./guideline.js";
export { hardwareClass, presetFromFetch, resolveDefaults, WILDCARD_HARDWARE_CLASS, } from "./defaults.js";
export { AGENT_DEFAULT_MODEL_NAMESPACE, agentDefaultOps, agentDefaultPointsAt, agentDefaultUnsetOps, apiKeyEnvFor, buildModelEntry, defaultApiKeyFor, LLM_PI_AI_NAMESPACE, modelRowsFrom, modelSlug, providerIdFor, providerRegistrationOps, providerRemovalOps, removeModelRow, upsertModelRow, } from "./registrar.js";
export { checkDeps, detectPackageManager, osLabel, planDeps, renderInstallString, runInstall, } from "./deps.js";
export { guardSudoCommand, sudoFailureDetail, SUDO_CLI_NOTE, SUDO_PASSWORD_TIMEOUT_MS, SUDO_PROBE_COMMAND, } from "./sudo.js";
export { CHAT_TEMPLATE_FILE, chatTemplateArtifactPath, chatTemplatePresent, hfChatTemplateCommand, hfDownloadCommand, hfDownloadFileCommand, hubCacheModelDirectory, hubCacheSnapshotFilePath, isModelDirectoryOverridden, modelArtifactPath, modelArtifactPresent, modelCacheEntriesForEngine, modelEntriesForEngine, repoIdFromUrl, repoNameFromUrl, } from "./models.js";
export { hfDatasetsCacheDirectory, hfHubCacheDirectory, modelDownloadTarget, resolveModelDirectory, } from "./hf-cache.js";
export { dshConfigCacheDirectory, dshEngineCacheDirectory, dshInferCacheDirectory, hfDownloadResultDirectory, } from "./infer-cache.js";
export { foldHfProgressChunk, parseHfProgressLine } from "./progress.js";
//# sourceMappingURL=index.js.map
