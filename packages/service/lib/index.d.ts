/**
 * Service Definition for the local-inference capability seam (`ctx.localInfer`):
 * the engine, preset, guideline, VramModel, and dep-plan registries plus the
 * orchestration entry points that turn a config and a hardware profile into an
 * estimate, a set of warnings, a dependency plan, a launch, and a registered
 * DSH model.
 *
 * Providers register against the registries; the tool package and the UI call
 * the entry points. Registration is order-independent and a duplicate id is a
 * loud conflict, so hot-reload order never changes routing. `estimate` is
 * filled in by Phase 2 over the core estimator, `guidelines` by Phase 3 over
 * the core guideline engine, `deps`, `installString`, and `runInstall` by
 * Phase 4 over the core provisioner, `launch` and `stop` by Phase 5 over the
 * registered engine adapters, `registerModel` and `removeModel` by
 * Phase 6 over the dsh settings seam, and `resolveDefaults` and
 * `fetchPreset` by Phase 7 over the core defaults resolver and the
 * mod-search bridge.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Config, DefaultModel, ModelDirectoryEntry, EngineAdapter, EngineDepPlan, EnginePlatformConfig, Guideline, GuidelineResult, HardwareProfile, HardwareProbes, InstallResult, LaunchPlan, ModelRow, Preset, PresetSource, RegisterResult, ReserveResolution, ResolvedDefaults, SystemDep, VramModel } from '@dsh/dsh-plugin-local-infer/core';
import type { DetectOsReserveOptions, DownloadModelOptions, DownloadResult, EstimateResult, FetchPresetOptions, FetchPresetResult, HfCliOptions, LaunchOptions, LaunchResult, LocalInferService, RegisterModelOptions } from './types.ts';
export type { DetectOsReserveOptions, DownloadModelOptions, DownloadResult, EstimateResult, FetchPresetOptions, FetchPresetResult, HfCliOptions, LaunchOptions, LaunchResult, LocalInferService, RegisterModelOptions, SettingsForms, SettingsNamespaceDescriptor, } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        localInfer: LocalInferService;
    }
}
/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_INVALID_MODEL`, `LOCAL_INFER_SETTINGS_UNAVAILABLE`) that
 * callers route on instead of parsing the message.
 */
export declare class LocalInferError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * `ctx.localInfer`. Holds the engine, preset, guideline, and VramModel
 * reservations; the registries are read per call so a provider that unloads
 * mid-session stops serving without leaving a stale route behind.
 */
export declare class LocalInfer extends Service implements LocalInferService {
    private readonly engineRegistry;
    private readonly presetRegistry;
    private readonly guidelineRegistry;
    private readonly vramModelRegistry;
    private readonly depPlanRegistry;
    private readonly platformConfigRegistry;
    private readonly launchedEngines;
    constructor(ctx: Context);
    registerEngine(adapter: EngineAdapter): () => void;
    registerPreset(preset: Preset): () => void;
    registerGuideline(guideline: Guideline): () => void;
    registerVramModel(model: VramModel): () => void;
    registeredEngines(): readonly EngineAdapter[];
    registeredPresets(): readonly Preset[];
    registeredGuidelines(): readonly Guideline[];
    registeredVramModels(): readonly VramModel[];
    /**
     * registerDepPlan reserves the per-engine dep plan (the docker and local
     * SystemDep lists the providers ship as data). The deps entry point asks a
     * registered adapter's systemDeps first and falls back to this plan for the
     * engine id, so an adapter that declares its own toolchain wins.
     */
    registerDepPlan(engineId: string, plan: EngineDepPlan): () => void;
    registeredDepPlans(): ReadonlyMap<string, EngineDepPlan>;
    /**
     * launchedEngineIds lists the engine ids this service's launch step
     * started and has not stopped. The OS-reserve resolver reads the list to
     * keep the 3 GiB default for a plugin-launched engine, whose footprint the
     * estimator already prices.
     */
    launchedEngineIds(): readonly string[];
    /**
     * registerEnginePlatformConfig stores the per-engine platform config (the
     * Engine Directory and Engine Fork the user adds for a specific engine). The
     * launch and deploy steps resolve it against the global modelDirectory to
     * produce the clone/build/download plan. A duplicate id replaces the stored
     * config, because a user editing the fields for an engine re-saves the whole
     * config rather than reserving a second slot.
     */
    registerEnginePlatformConfig(config: EnginePlatformConfig): () => void;
    /**
     * enginePlatformConfig reads the stored platform config for an engine id, or
     * undefined when none is stored, which the deploy step reads as "use the
     * adapter's default source and a managed cache directory".
     */
    enginePlatformConfig(engineId: string): EnginePlatformConfig | undefined;
    /**
     * estimate prices a config against the resolved VramModel and the detected
     * hardware. The OS reserve resolves dynamically (the Phase 10 order:
     * explicit config value, then the plugin-launched / foreign-process /
     * GPU-usage probes), so the meter, the verdict, and the DSH contextWindow
     * all price the same usable budget. The result carries the reserve's
     * source, so the meter's readout names where the number came from.
     */
    estimate(config: Config, hw: HardwareProfile, engineId?: string): Promise<EstimateResult>;
    /**
     * detectHardware runs the host probes (nvidia-smi, docker, WSL2, OS, CPU,
     * RAM) and turns their results into the HardwareProfile every relationship
     * consumes. A probe that fails or times out degrades to "not available"
     * for that capability, so detection never throws on a bare host.
     */
    detectHardware(): Promise<HardwareProfile>;
    /**
     * detectOsReserve runs the Phase 10 OS-reserve probes and resolves the
     * reserve: the plugin-launched check against this service's launched
     * engines, the process-signature match of the running process table
     * against every registered adapter's launch signature (the engine binary
     * or docker image, the port, the env keys), and the GPU-usage reading.
     * The resolution order is the core resolver's: a plugin-launched engine
     * keeps the 3 GiB default, a detected foreign engine raises the reserve to
     * the GPU's used VRAM, and the 75%-usage fallback raises it further when
     * no process signature matched. The options inject the probe results, so
     * a test prices a busy card without a live nvidia-smi or ps.
     */
    detectOsReserve(config?: Config, options?: DetectOsReserveOptions): Promise<ReserveResolution>;
    /**
     * guidelines runs the full guideline engine over a config and a hardware
     * profile: the registered named guidelines, every per-spec hardware
     * constraint of the registered engines, and the model-aware rules that
     * price against the resolved VramModel (the estimator-backed "exceeds
     * usable VRAM" and "spec needs draft weights" rules). The result list is
     * the single source the UI banner and the inline red warnings render from.
     */
    guidelines(config: Config, hw: HardwareProfile, engineId?: string): Promise<GuidelineResult[]>;
    /**
     * deps resolves the host deps an engine's deploy step needs for a build
     * mode. A registered adapter that declares systemDeps wins; the provider-
     * registered plan for the engine id is the fallback, and an engine with
     * neither plans an empty list (nothing to install, the gate passes).
     */
    deps(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<readonly SystemDep[]>;
    /**
     * installString renders the copy/paste block for the resolved dep plan,
     * keyed to the detected package manager, with the by-hand note for a dep
     * the manager has no commands for.
     */
    installString(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<string>;
    /**
     * runInstall is the Play/Run path: it runs the resolved dep plan's commands
     * through the shell runner and re-probes each dep. The runner captures the
     * per-command exit, so a failure names the command that broke.
     */
    runInstall(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<InstallResult>;
    /**
     * launch is the lifecycle entry point: it resolves the adapter that rendered
     * the plan (by the plan's engineId), runs the adapter's deploy step (build
     * or pull, download the model, start the engine) with the stored platform
     * config, then polls the health URL until the engine reports 200. A deploy
     * failure or a health timeout reads as not-healthy with the detail, so the
     * UI shows the broken step rather than a blank panel.
     */
    launch(plan: LaunchPlan, options?: LaunchOptions): Promise<LaunchResult>;
    /**
     * stop signals the engine a launch started: it resolves the adapter by the
     * plan's engineId and runs the adapter's stop step (kill the tracked process,
     * stop the named container, or compose down).
     */
    stop(plan: LaunchPlan): Promise<void>;
    /**
     * registerModel publishes a confirmed-working engine as a DSH model. It
     * builds the entry from the plan (the provider id, the base URL, and the
     * API-key env name derive from the engine id), reads the llm-pi-ai section
     * through the settings seam, and upserts the provider's models list with a
     * path-addressed mutate guarded by the section's revision, so a stale
     * write is refused rather than overwriting a concurrent edit. Re-running
     * with the same model replaces the row in place, never duplicating it.
     * With agentDefault, the agent default model section points at the new
     * provider and model, so a new session starts from the local engine.
     */
    registerModel(plan: LaunchPlan, model: ModelRow, options?: RegisterModelOptions): Promise<RegisterResult>;
    /**
     * removeModel removes a registered model from its provider: the models
     * list without the row, the whole provider when the row was the last one,
     * and the agent default section cleared when it pointed at the removed
     * pair. Removing a model the provider does not carry is a no-op, so a
     * stop with nothing registered stays quiet.
     */
    removeModel(providerId: string, modelId: string): Promise<void>;
    /**
     * resolveDefaults resolves the starting Config for an engine, model, and
     * detected hardware over the registered presets and the engine's parameter
     * surface. The resolution order (explicit value, exact-class preset,
     * built-in preset, spec default) and the per-key provenance are the core
     * resolver's, so the meter, the form, and the DSH contextWindow all price
     * the same starting config.
     */
    resolveDefaults(engineId: string, modelId: string, hw: HardwareProfile, explicit?: Config): Promise<ResolvedDefaults>;
    /**
     * fetchPreset is the mod-search fetch path: it runs the bridge over the
     * source's URL, extracts the values with the source's pure extractor, tags
     * the result with the URL and the fetch date, persists it to the preset
     * store, and registers it so the next resolveDefaults uses it. When the
     * bridge is unavailable (no CLI, a failed fetch) it degrades to a
     * not-stored, degraded answer so the caller falls back to the built-in
     * presets and says so.
     */
    fetchPreset(source: PresetSource, options?: FetchPresetOptions): Promise<FetchPresetResult>;
    /**
     * defaultModelDirectory is the plugin's model download directory: under
     * the dsh home so a web user and a CLI user share one location, the way the
     * config file does. The directory is created when absent, so the field's
     * default is always a real path the deploy step can target.
     */
    defaultModelDirectory(): string;
    /**
     * hfCliAvailable probes for the hf CLI the model download runs: an
     * injected cliPath wins, then the `hf` binary on PATH. None found reads as
     * null, which the card renders as the no-CLI row with the model URL.
     */
    hfCliAvailable(options?: HfCliOptions): Promise<string | null>;
    /**
     * downloadModel runs the hf CLI download for one default model into the
     * model directory: it creates the target directory when absent (the
     * recursive flag covers the parents too), renders the command through the
     * core builder (the single source the card shows), and runs it through the
     * injected runner when one is given, so a test captures the command without
     * a live hf. A failure keeps the runner's detail, so the card names the
     * broken step.
     */
    downloadModel(entry: DefaultModel, directory: string, options?: DownloadModelOptions): Promise<DownloadResult>;
    /**
     * listModelDirectory lists the top-level entries of a model directory, the
     * data the Model dropdown's directory scan draws from. Dot entries (the
     * `.cache` the hf CLI keeps) never name a model, so they are skipped. A
     * directory entry carries the `hasSafetensors` marker the Hyper-Qwen
     * filter reads: a repo folder with a weight file is a usable local model.
     * A missing or unreadable directory reads as an empty list, which the
     * route renders as "no local models".
     */
    listModelDirectory(directory: string): ModelDirectoryEntry[];
    /**
     * specsForEngine reads the parameter surface of the registered adapter for
     * an engine id, so the defaults resolver floors the result on that engine's
     * own spec defaults. An engine no adapter serves floors on an empty
     * surface, which reads as "no spec defaults" rather than a collision.
     */
    private specsForEngine;
    /**
     * resolveModsearchCli finds the modsearch CLI script the fetch path spawns.
     * An injected cliPath wins, then the MODSEARCH_CLI env, then the modsearch
     * bin on PATH. None found reads as the bridge being unavailable, which
     * fetchPreset degrades on.
     */
    private resolveModsearchCli;
    /**
     * fetchPage runs the modsearch CLI over one URL and reads the fetched page
     * content out of its JSON answer. The CLI's fetch schema carries a
     * `content` string; a non-JSON answer or a nonzero exit reads as a failed
     * fetch, which the caller degrades on.
     */
    private fetchPage;
    /**
     * storePreset persists a fetched preset to the preset store, replacing any
     * stored preset with the same (engine, model, class) key so a re-fetch
     * refreshes in place rather than duplicating.
     */
    private storePreset;
    /**
     * readPresetStore reads the stored presets, degrading a missing or broken
     * file to an empty list so a first fetch starts a fresh store.
     */
    private readPresetStore;
    /**
     * registerIfNew registers a fetched preset with the seam, skipping the
     * write when the preset's key is already reserved, so a re-fetch of a
     * built-in triple does not trip the duplicate-id conflict.
     */
    private registerIfNew;
    /**
     * settings narrows the context to the dsh settings service the registrar
     * writes through. A profile without the service (a headless install) fails
     * loudly with a stable code, so a caller never mistakes "no seam" for a
     * published model.
     */
    private settings;
    /**
     * descriptor reads one settings entry by namespace key. The read requests
     * secret redaction, because the registrar prices the section it edits and
     * a secret value must never ride into the core's pure ops.
     */
    private descriptor;
    /**
     * Picks the VramModel an estimate prices against: the one the config names
     * by `model`, or the single registered model when the config names none.
     * Zero or several candidates with no name leave the estimate not-measured
     * rather than a guess.
     */
    private resolveVramModel;
    /**
     * collectLaunchSignatures gathers the launch signatures of every registered
     * adapter for a config, so the OS-reserve probe matches the running process
     * table against each engine's own toArgv/toEnv spelling. An adapter without
     * a signature (one whose engine leaves no host process) contributes none.
     */
    private collectLaunchSignatures;
    /**
     * resolveReserveFor resolves the OS reserve an estimate prices: an explicit
     * config value (reserveMiB or reserveGiB) wins and reads as 'explicit'
     * without running a probe, else the Phase 10 resolution over the probes
     * (the plugin-launched check, the foreign-process match, the GPU-usage
     * reading). The answer is the single source the meter, the verdict, and
     * the DSH contextWindow price.
     */
    private resolveReserveFor;
    /**
     * collectSpecs gathers the parameter surfaces of every registered engine,
     * deduped by key in registration order. A key two engines share (spec,
     * draftTokens, vision) keeps the first engine's spec, so a config warning
     * reads from one surface, not a collision.
     */
    private collectSpecs;
}
/**
 * runHardwareProbes collects the raw probe results the detector consumes: the
 * OS, CPU thread count, host RAM, the GPU reading, docker availability,
 * WSL2, and the package-manager winner. The WSL2 read is a kernel-release
 * check (WSL2 kernels carry a "microsoft-standard-WSL2" suffix), which needs
 * no child process.
 */
export declare function runHardwareProbes(): Promise<HardwareProbes>;
export default LocalInfer;
//# sourceMappingURL=index.d.ts.map