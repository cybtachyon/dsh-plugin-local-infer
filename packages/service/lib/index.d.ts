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
 * @module dsh-plugin-local-infer/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { BuildMode, CommandOutcome, CommandRunner, Config, DefaultModel, ModelCacheEntry, ModelDirectoryEntry, EngineAdapter, EngineDepPlan, EnginePlatformConfig, GpuUsageProbe, Guideline, GuidelineResult, HardwareProfile, HardwareProbes, InstallResult, LaunchPlan, ModelRow, Preset, PresetSource, ProcessLine, ProviderLaunchRecord, ProviderRef, ProviderStatus, ReLinkOutcome, RegisterResult, ReserveResolution, ResolvedDefaults, SudoGuard, SystemDep, VramModel } from 'dsh-plugin-local-infer/core';
import type { DetectOsReserveOptions, DownloadModelOptions, DownloadResult, EngineDeathEvent, EstimateResult, FetchPresetOptions, FetchPresetResult, HfCliOptions, LaunchOptions, LaunchResult, LocalInferService, ProviderStatusOptions, RegisterModelOptions } from './types.ts';
export type { DetectOsReserveOptions, DownloadModelOptions, DownloadResult, EngineDeathEvent, EstimateResult, FetchPresetOptions, FetchPresetResult, HfCliOptions, LaunchOptions, LaunchResult, LocalInferService, ProviderStatusOptions, RegisterModelOptions, SettingsDescribeResult, SettingsForms, SettingsNamespaceDescriptor, } from './types.ts';
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
    private readonly launchedModels;
    private readonly launchedPorts;
    private readonly engineWatchers;
    private readonly handledPids;
    private readonly launchingEngines;
    private readonly stoppingEngines;
    private deathObserver;
    private sudoObserver;
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
     * providerStatuses resolves the running-state the card paints each saved
     * provider's status dot from. It prices each provider's own launch signature
     * through the registered adapter (the build mode's binary, the port the
     * provider's config binds, the env keys), so an engine the plugin launched
     * on a non-default port matches its config instead of reading forever as a
     * process no signature covers, and ties the matched port to the model the
     * plugin launched it with (the launched-models map). The GPU-usage reading
     * feeds the busy-card rule. The answer is the core resolver's: a busy card
     * or no engine running reads as unsure for every provider, an engine the
     * detector saw but could not tie to a model reads as unsure for its configs
     * and stopped for the rest, and a confirmed engine-plus-model reads as
     * running. The options inject the probe results, so a test prices a busy
     * card or a foreign engine without a live nvidia-smi or ps.
     */
    providerStatuses(providers: readonly ProviderRef[], options?: ProviderStatusOptions): Promise<Record<string, ProviderStatus>>;
    /**
     * unsureBannerKillCommands returns the stop commands for the engine
     * processes the detector saw holding VRAM, for the "unsure" banner the card
     * shows when no provider is confirmed running but at least one reads as
     * unsure. A process is included when its command line carries an engine
     * binary marker and the card's VRAM usage is above 30% of the total (the
     * threshold below which a foreign engine is not considered to be holding
     * the card). The command form switches on the host OS: one
     * `Stop-Process -Id <pid>` per matching process on Windows (the PowerShell
     * cmdlet the banner's text area runs), one `kill <pid>` on Linux and macOS,
     * in pid order. An empty list means no matching process was seen, so the
     * banner's text area renders empty.
     */
    unsureBannerKillCommands(options?: {
        processes?: ProcessLine[];
        gpuUsage?: GpuUsageProbe | null;
    }): Promise<string[]>;
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
     * neither plans an empty list (nothing to install, the gate passes). The
     * local list is per-OS: a Windows host reads the plan's windows entry (the
     * winget toolchain the providers sourced from the Windows profile), every
     * other host reads the linux entry, so the System dependencies section
     * shows the right toolchain for the host.
     */
    deps(engineId: string, buildMode: BuildMode, hw: HardwareProfile): Promise<readonly SystemDep[]>;
    /**
     * installString renders the copy/paste block for the resolved dep plan,
     * keyed to the detected package manager, with the by-hand note for a dep
     * the manager has no commands for.
     */
    installString(engineId: string, buildMode: BuildMode, hw: HardwareProfile): Promise<string>;
    /**
     * runInstall is the Play/Run path: it runs the resolved dep plan's commands
     * through the guarded shell runner and re-probes each dep. The runner
     * captures the per-command exit, so a failure names the command that broke,
     * and a declared-sudo command whose probe finds no cached credentials
     * announces the CLI prompt through the sudo observer and fails at the
     * sudo deadline.
     */
    runInstall(engineId: string, buildMode: BuildMode, hw: HardwareProfile): Promise<InstallResult>;
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
     * reLinkProviders re-links the engines a previous DSH process started for
     * the stored provider config entries, so a DSH restart re-adopts a
     * surviving engine instead of reading it as a foreign process. Each record
     * is priced by the core re-link rule: the engine pid must be alive and its
     * command line must still carry the record's launch arguments, and the
     * record's parent pid must be the current DSH pid or a previous DSH pid
     * that is no longer running (a live previous pid is a DSH clone that owns
     * the engine, and an unknown parent is a user-launched engine). An adopted
     * engine is re-marked plugin-launched (the OS-reserve default) and tied to
     * its model (the provider-status detector's green dot); a dead engine
     * reads as dead, so the caller clears the record and a recycled pid cannot
     * re-link. The options inject the process probes, so a test prices a live
     * or dead engine without a live process table.
     */
    reLinkProviders(entries: readonly {
        id: string;
        record: ProviderLaunchRecord;
    }[], options?: {
        processAlive?: (pid: number) => boolean;
        commandLine?: (pid: number) => string | undefined;
    }): Promise<Record<string, ReLinkOutcome>>;
    /**
     * setEngineDeathObserver registers the route's hook for engine process
     * deaths: a crash or pkill seen through a launched handle's exit event, or a
     * poll-detected death of a process adopted from a stored launch record. The
     * observer persists the provider entry's cleared state so the card reads the
     * provider stopped instead of carrying a stale record. Passing undefined
     * clears it, which the route's effect does on dispose.
     */
    setEngineDeathObserver(observer: ((event: EngineDeathEvent) => void) | undefined): void;
    /**
     * setSudoObserver registers the route's hook for commands the sudo guard
     * found waiting for a password on the launching CLI: the observer shows the
     * "Check your CLI for a sudo prompt" note while the command waits. Passing
     * undefined clears it, which the route's effect does on dispose.
     */
    setSudoObserver(observer: ((command: string) => void) | undefined): void;
    /**
     * notifySudoNeeded announces one guarded command to the registered sudo
     * observer, if any. A throwing observer is swallowed: the note is a log
     * courtesy, and a broken route must not fail the install that is already
     * racing the sudo deadline.
     */
    private notifySudoNeeded;
    /**
     * watchLaunchedHandle ties a launched child's one-shot exit to the live
     * state: the host's close/error event (a crash, a pkill, or the stop kill)
     * reports through observeEngineDeath. A handle whose host cannot watch (no
     * onExit, a stub) is left to the re-link rule to price after a restart.
     */
    private watchLaunchedHandle;
    /**
     * watchAdoptedEngine re-attaches the exit watch for a process this DSH did
     * not spawn: a surviving engine adopted from a stored launch record has no
     * ChildProcess to listen on after a restart, so an unref'd poll on the
     * liveness probe stands in for the exit event. When the pid dies the watcher
     * stops itself and reports through observeEngineDeath, so the provider's
     * state settles without waiting for the next summary re-link to price the
     * record dead.
     */
    private watchAdoptedEngine;
    /**
     * engineKey is the in-flight state machine's key for one engine: the engine
     * id plus its port when the plan names one, so two configs of one engine on
     * different ports are distinct engines. A plan with no port keys on the
     * engine id alone.
     */
    private engineKey;
    /**
     * stopEngineWatcher cancels one port's adopted-process poll, if it has one.
     */
    private stopEngineWatcher;
    /**
     * observeEngineDeath settles one engine process's death against the live
     * state: the port-to-model tie drops when the dead engine still owns the
     * port, the port leaves the engine's live ledger, the plugin-launched flag
     * clears with the engine's last live port, the adopted-process watcher for
     * the port stops, and the registered death observer (the route's persistence
     * hook) receives the event. The launch record itself is the route's: the
     * observer clears the provider entry's record so the card reads the provider
     * stopped, not stale.
     */
    private observeEngineDeath;
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
     * defaultModelDirectory is the plugin's model download directory: the
     * Hugging Face hub cache the hf CLI and huggingface_hub share (HF_HUB_CACHE
     * when set, then $HF_HOME/hub, then ~/.cache/huggingface/hub), so a model
     * the plugin pulls lands where every other HF tooling looks. The directory
     * is created when absent, so the field's default is always a real path the
     * deploy step can target.
     */
    defaultModelDirectory(): string;
    /**
     * defaultDatasetDirectory is the plugin's dataset download directory: the
     * Hugging Face datasets cache (HF_DATASETS_CACHE when set, then
     * $HF_HOME/datasets, then ~/.cache/huggingface/datasets). Created when
     * absent, for the same reason the model directory is.
     */
    defaultDatasetDirectory(): string;
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
     * downloadChatTemplate pulls the chat template file for one HF repo
     * reference into the model directory, so a selected template (the Froggeric
     * set, a custom repo) works out of the box. It shares the model download's
     * recursive directory creation, runner, and long timeout: a template is a
     * small file, but the hf CLI's cold start and auth are the same cost.
     */
    downloadChatTemplate(repo: string, directory: string, options?: DownloadModelOptions): Promise<DownloadResult>;
    /**
     * modelIsRegistered reports whether a provider entry with the named model is
     * already registered in the DSH settings, so the save route can sync the
     * registered model's input types (the vision flag) without duplicating a
     * fresh registration. A provider the section does not carry reads as
     * unregistered.
     */
    modelIsRegistered(providerId: string, modelId: string): Promise<boolean>;
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
     * listModelCache lists the hub cache's `models--*` directories, the data the
     * per-engine model dropdown's cache scan draws from when the model directory
     * is the plugin default (the hub cache). Each entry carries the repo id the
     * directory names (the `{namespace}/{name}` decoded from the
     * `models--{ns}--{name}` form) and the artifact file names its snapshots
     * hold (the union across every commit). A missing or unreadable cache reads
     * as an empty list, which the route renders as "no cached models".
     */
    listModelCache(): ModelCacheEntry[];
    /**
     * snapshotFiles unions the file names across every commit directory under a
     * `models--*` dir's `snapshots/`, the artifact set the per-engine cache scan
     * filters. A missing snapshots folder reads as an empty set.
     */
    private snapshotFiles;
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
     * mutateSettings applies a path-addressed edit through the typert remote
     * settings seam and surfaces a refusal as a stable code. The controller
     * classifies provider refusals (a conflict, a rejected write) into the
     * envelope's message, so the registrar reports the reason, not a bare throw.
     */
    private mutateSettings;
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
 * sudoProbe answers whether sudo already holds cached (or NOPASSWD)
 * credentials: it runs SUDO_PROBE_COMMAND non-interactively through the
 * probe timeout and reads a clean exit as "no prompt is coming". A refused
 * -n, a missing sudo, and a hung probe all read as "a prompt is coming",
 * the safe side: the run announces and caps instead of dead-locking on a
 * TTY the card user cannot see.
 */
export declare function sudoProbe(): Promise<boolean>;
/**
 * sudoGuardFor is the service-side binding of core's guardSudoCommand: it
 * supplies sudoProbe, so this package's install runner and the providers'
 * lifecycle host drive one probe and one rule from one function. Calling
 * it is itself the sudo declaration (needsSudo is true); callers gate on
 * their own needsSudo fact first and never run a plain command through it.
 */
export declare function sudoGuardFor(command: string, notify: (command: string) => void, kill: () => void, timeoutMs?: number): Promise<SudoGuard>;
/**
 * guardedShellRunner builds the Play/Run runner: it runs one command line
 * through the system shell and reports the exit. stdin stays closed. When
 * core hands the command the dep's sudo declaration and sudoProbe finds no
 * cached credentials, core's guard announces the CLI prompt through notify
 * and arms the password deadline; its fire SIGTERMs the child and the run
 * settles with sudoFailureDetail instead of the shell's bare signal exit.
 * The guard adds only probe, notify, and deadline to the existing spawn;
 * the copy/paste path stays the fallback for a passwordless host.
 */
export declare function guardedShellRunner(notify: (command: string) => void): CommandRunner;
/**
 * downloadRunner is the model-download runner: it spawns the rendered hf CLI
 * command through the system shell and reports the exit. The spawned child's
 * stdout and stderr chunks stream to onChunk as they land (the hf CLI's tqdm
 * progress), while the output tail keeps the last kilobyte, the same rule the
 * install runner uses, so a failure names the broken line. An abort on the
 * optional signal interrupts the in-flight child (SIGINT, then SIGTERM), so a
 * canceled download stops instead of running to the timeout. The optional
 * graceMs overrides the 5 s SIGTERM escalation window for the abort path.
 */
export declare const downloadRunner: (command: string, signal?: AbortSignal, onChunk?: (chunk: string) => void, graceMs?: number) => Promise<CommandOutcome>;
/**
 * parseWindowsProcessTable reads the `pid<TAB>commandLine` rows PowerShell's
 * Win32_Process probe emits into process lines the launch-signature matcher
 * consumes. Each row is split on its first tab: the pid is the left field, the
 * command line the right. A row with no tab (a system process with an empty
 * command line, trimmed to its pid alone) is skipped, and a non-numeric pid is
 * dropped. The env element stays undefined: Windows has no /proc environ to
 * read, and the matcher reads a missing env as neutral.
 */
export declare function parseWindowsProcessTable(stdout: string): ProcessLine[];
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
