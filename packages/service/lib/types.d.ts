import type { BuildMode, CommandLogger, CommandOutcome, CommandRunner, Config, DefaultModel, ModelCacheEntry, ModelDirectoryEntry, EngineAdapter, EngineDepPlan, EngineLaunchState, EnginePlatformConfig, Guideline, GuidelineResult, GpuUsageProbe, HardwareProfile, InstallResult, LaunchPlan, LaunchProgress, ModelRow, Preset, PresetSource, ProcessLine, ProviderLaunchRecord, ProviderRef, ProviderStatus, ReLinkOutcome, RegisterResult, ReserveResolution, ReserveSource, ResolvedDefaults, SettingsOp, SystemDep, VramBreakdown, VramModel, VramVerdict } from 'dsh-plugin-local-infer/core';
/**
 * EstimateResult is the answer to an estimate call: the full VRAM breakdown,
 * the one-word verdict the meter renders, the source the numbers came from,
 * so the meter labels measured versus estimated, and the source the OS
 * reserve in the breakdown came from, so the meter's reserve readout names
 * the 3 GiB default, a config value, a foreign engine, or the GPU-usage
 * fallback.
 */
export interface EstimateResult {
    breakdown: VramBreakdown;
    verdict: VramVerdict;
    source: 'measured' | 'estimated' | 'not-measured';
    reserveSource: ReserveSource;
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
    engineId?: string;
    gpuUsage?: GpuUsageProbe | null;
    processes?: ProcessLine[];
}
/**
 * ProviderStatusOptions tunes the provider-status detection: processes and
 * gpuUsage inject the probe results, so a test prices a busy card or a foreign
 * engine without a live nvidia-smi or ps. An absent probe result runs the live
 * probe; a present one (including an explicit null GPU reading) is used as
 * given.
 */
export interface ProviderStatusOptions {
    processes?: ProcessLine[];
    gpuUsage?: GpuUsageProbe | null;
}
/**
 * EngineDeathEvent is the one-shot report that an engine process the plugin
 * tracked has ended: an observed crash or pkill (the exit code and signal from
 * a live child's close event, or a spawn error detail for a child that never
 * ran), or a poll-detected death of a process adopted from a stored launch
 * record after a DSH restart (a null code and signal with a detail). The route
 * registers the observer that persists the provider entry's cleared state, so
 * the card reads the provider stopped instead of carrying a stale record.
 */
export interface EngineDeathEvent {
    engineId: string;
    port?: number;
    modelId?: string;
    pid?: number;
    code: number | null;
    signal: string | null;
    detail?: string;
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
 * record for the restart re-link. `buildLogs` is the deploy step's own
 * captured output (the rebuild decision, the build command, and its output)
 * kept separate from the engine's runtime `logs`, so the route can order the
 * launch command after a build (or after a direct launch) and before the
 * engine output.
 */
export interface LaunchResult {
    plan: LaunchPlan;
    healthy: boolean;
    detail?: string;
    logs?: string;
    buildLogs?: string;
    pid?: number;
    parentPid?: number;
    state?: EngineLaunchState;
}
/**
 * LaunchOptions tunes the launch health poll: the interval between attempts
 * and the attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through; an absent option keeps the adapter's default.
 * `onProgress`, when present, is called as each launch phase (the deploy
 * sub-steps and the health poll) begins, so the card's Launch control reads
 * the phase that is actually running. `allowRunDeps` is the Play/Run trust gate
 * (the card's "Allow one-click install (sudo)" checkbox) the deploy step reads
 * to decide whether a rebuild's missing-binary symlink into /usr/local/bin runs
 * (on) or is written to the card's Logs section (off). `autoRebuild` is the
 * card's "Auto Rebuild" checkbox: when false, the deploy step skips the git
 * sync (fetch, rebase, rebuild) and launches the checkout as-is. Absent reads
 * as true (the rebuild runs). `onLog` is the launch run's log sink: the
 * deploy step writes the `$ <command>` line of every mutating command it runs
 * (image pull, model download) through it before the child spawns.
 */
export interface LaunchOptions {
    pollMs?: number;
    maxAttempts?: number;
    onProgress?: LaunchProgress;
    allowRunDeps?: boolean;
    autoRebuild?: boolean;
    onLog?: CommandLogger;
}
/**
 * RegisterModelOptions tunes the model registration: agentDefault points the
 * agent default model at the registered provider and model, so a new agent
 * session starts from the local engine.
 */
export interface RegisterModelOptions {
    agentDefault?: boolean;
}
/**
 * RunInstallOptions tunes the Play/Run install: `onLog` is the install run's
 * log sink, and the service writes each command the runner is about to
 * execute as a `$ <command>` line through it before the child spawns, so the
 * run reads command first and per-dep results after. `runner` injects the
 * command runner, so a test captures the command lines without spawning a
 * real shell (the way downloadModel injects its download runner).
 */
export interface RunInstallOptions {
    onLog?: CommandLogger;
    runner?: CommandRunner;
}
/**
 * FetchPresetResult is the answer to a mod-search preset fetch: the tagged
 * preset when the bridge fetched and extracted it, a storage flag, and a
 * degraded flag that is set when the bridge was unavailable and the caller
 * should fall back to the built-in presets.
 */
export interface FetchPresetResult {
    preset: Preset | undefined;
    stored: boolean;
    degraded: boolean;
    detail?: string;
}
/**
 * FetchPresetOptions tunes the mod-search fetch: cliPath overrides where the
 * modsearch CLI is resolved from, so a test injects a stub and a profile with
 * a non-default install points at its own copy.
 */
export interface FetchPresetOptions {
    cliPath?: string;
}
/**
 * HfCliOptions tunes the hf CLI probe: cliPath overrides where the CLI is
 * resolved from, so a test injects a stub and a profile with a non-default
 * install points at its own copy.
 */
export interface HfCliOptions {
    cliPath?: string;
}
/**
 * DownloadResult is the answer to a model download: ok, or a detail naming
 * the broken step the card shows beside its Download button.
 */
export interface DownloadResult {
    ok: boolean;
    detail?: string;
}
/**
 * DownloadModelOptions tunes the model download: runner injects the command
 * runner, so a test captures the rendered hf CLI command without a live hf.
 * onChunk is the callback the runner hands each streamed stdout and stderr
 * chunk to, so the card's Logs pane reads the hf CLI's progress live while a
 * long download runs. useHubCache selects the hub-cache layout (no
 * `--local-dir`, the `models--{ns}--{name}` directories) when the model
 * directory is the plugin default; a user-overridden directory keeps the flat
 * `--local-dir` target. signal is the card's cancel: an abort interrupts the
 * in-flight hf child (SIGINT, then SIGTERM). Resume is within-invocation only
 * (the hf CLI resumes a network blip via HTTP Range inside one run); a killed
 * run re-downloads from zero on the re-run, and the orphaned `.incomplete`
 * blob lingers until `hf cache prune`.
 * onLog is the run's log-text sink: the service writes the rendered command's
 * `$ <hf download ...>` line through it before the runner spawns the child,
 * so every download path (Get step, launch, download route) logs the command
 * exactly once, from the exec site, ahead of its output.
 */
export interface DownloadModelOptions {
    runner?: (command: string, signal?: AbortSignal, onChunk?: (chunk: string) => void) => Promise<CommandOutcome>;
    onChunk?: (chunk: string) => void;
    onLog?: CommandLogger;
    useHubCache?: boolean;
    signal?: AbortSignal;
}
/**
 * SettingsNamespaceDescriptor is the structural view of one profile plugin
 * entry the registrar reads: its namespace key, the resolved section value,
 * and the revision the write hands back as the conflict guard.
 */
export interface SettingsNamespaceDescriptor {
    ns: string;
    revision: number;
    value: unknown;
}
/**
 * SettingsDescribeResult is the structural view of the dsh settings service's
 * describe answer: whether the section is writable, whether a document exists,
 * and the redacted namespace views the registrar reads and writes through.
 */
export interface SettingsDescribeResult {
    writable: boolean;
    hasDocument: boolean;
    namespaces: readonly SettingsNamespaceDescriptor[];
}
/**
 * SettingsRemoteResponse is the typert remote envelope every settings
 * namespace method answers with: a business `value` on `ok`, or a `message`
 * on a refusal. The typert protocol wraps the controller's plain answer in
 * this shape, so the registrar must unwrap `value` before reading it.
 */
export interface SettingsRemoteResponse<T> {
    ok: boolean;
    value?: T;
    error?: {
        message: string;
    };
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
export type SettingsDescribeAnswer = SettingsRemoteResponse<SettingsDescribeResult> | SettingsDescribeResult | readonly SettingsNamespaceDescriptor[];
export interface SettingsForms {
    describe(options?: {
        redactSecrets?: boolean;
    }): Promise<SettingsDescribeAnswer>;
    mutate(ns: string, ops: readonly SettingsOp[], expectedRevision?: number): Promise<SettingsRemoteResponse<unknown> | undefined>;
}
/**
 * LaunchTargetEntry is the stored provider entry shape findLaunchTarget
 * reads: the entry id, the engine id, and the config whose model field the
 * engine-and-model match prices. The ui store's StoredProviderConfig
 * satisfies it structurally, so the matcher stays free of the store shape.
 */
export interface LaunchTargetEntry {
    id: string;
    engine: string;
    config: Config;
}
/**
 * RunLogSnapshot is the catch-up read of one run key's live log: the append
 * count reached (the `seq` every later stream event continues), the bounded
 * tail text (LOG_TAIL_BYTES), and whether a run is still writing. A mid-run
 * page refresh or a late-opened Logs pane renders from this snapshot and
 * then follows the live events, so it shows the same text a continuously
 * attached reader has.
 */
export interface RunLogSnapshot {
    seq: number;
    text: string;
    running: boolean;
}
/**
 * RunLogResetEvent announces a beginRun for the subscribed key: the buffer
 * restarted at the seed text with seq 0, so a reader replaces its display
 * instead of appending onto the previous run's text.
 */
export interface RunLogResetEvent {
    kind: 'reset';
    seq: number;
    text: string;
}
/**
 * RunLogAppendEvent carries one live log append: `text` is the appended
 * chunk (not the buffer), and `seq` is the buffer's append count after the
 * chunk landed, so a reader that caught up from a snapshot can drop events
 * it already holds.
 */
export interface RunLogAppendEvent {
    kind: 'log';
    seq: number;
    text: string;
}
/**
 * RunLogEndEvent announces endRun for the subscribed key: the run stopped
 * writing at `seq`. The text stays readable (readRunLog) until the next
 * beginRun for that key.
 */
export interface RunLogEndEvent {
    kind: 'end';
    seq: number;
}
/**
 * RunLogEvent is one live update on a subscribed run key: the buffer reset
 * by a begin, one appended chunk, or the run's end.
 */
export type RunLogEvent = RunLogResetEvent | RunLogAppendEvent | RunLogEndEvent;
/**
 * RunLogListener receives a subscribed key's RunLogEvents. Listeners are
 * independent per connection: a throwing or removed listener never blocks
 * the writer or another subscriber.
 */
export type RunLogListener = (event: RunLogEvent) => void;
/**
 * LocalInferService is the surface the service publishes on ctx.localInfer.
 * Providers register engines, presets, and guidelines against the registries;
 * consumers (the tool package, the UI) call the orchestration entry points.
 * The registries are order-independent: selection never depends on
 * registration order, and a duplicate id is a loud conflict.
 */
export interface LocalInferService {
    registerEngine(adapter: EngineAdapter): () => void;
    registerPreset(preset: Preset): () => void;
    registerGuideline(guideline: Guideline): () => void;
    registerVramModel(model: VramModel): () => void;
    registerDepPlan(engineId: string, plan: EngineDepPlan): () => void;
    registerEnginePlatformConfig(config: EnginePlatformConfig): () => void;
    registeredEngines(): readonly EngineAdapter[];
    registeredPresets(): readonly Preset[];
    registeredGuidelines(): readonly Guideline[];
    registeredVramModels(): readonly VramModel[];
    registeredDepPlans(): ReadonlyMap<string, EngineDepPlan>;
    enginePlatformConfig(engineId: string): EnginePlatformConfig | undefined;
    launchedEngineIds(): readonly string[];
    estimate(config: Config, hw: HardwareProfile, engineId?: string): Promise<EstimateResult>;
    detectHardware(): Promise<HardwareProfile>;
    detectOsReserve(config?: Config, options?: DetectOsReserveOptions): Promise<ReserveResolution>;
    providerStatuses(providers: readonly ProviderRef[], options?: ProviderStatusOptions): Promise<Record<string, ProviderStatus>>;
    unsureBannerKillCommands(options?: {
        processes?: ProcessLine[];
        gpuUsage?: GpuUsageProbe | null;
    }): Promise<string[]>;
    guidelines(config: Config, hw: HardwareProfile, engineId?: string): Promise<GuidelineResult[]>;
    deps(engineId: string, buildMode: BuildMode, hw: HardwareProfile): Promise<readonly SystemDep[]>;
    installString(engineId: string, buildMode: BuildMode, hw: HardwareProfile): Promise<string>;
    runInstall(engineId: string, buildMode: BuildMode, hw: HardwareProfile, options?: RunInstallOptions): Promise<InstallResult>;
    launch(plan: LaunchPlan, options?: LaunchOptions): Promise<LaunchResult>;
    stop(plan: LaunchPlan, log?: CommandLogger): Promise<void>;
    reLinkProviders(entries: readonly {
        id: string;
        record: ProviderLaunchRecord;
    }[], options?: {
        processAlive?: (pid: number) => boolean;
        commandLine?: (pid: number) => string | undefined;
    }): Promise<Record<string, ReLinkOutcome>>;
    /**
     * setEngineDeathObserver registers the callback the route uses to persist a
     * provider entry's cleared state when its engine process dies (a crash, a
     * pkill, or a poll-detected death of an adopted process). Passing undefined
     * clears it, which the route's effect does on dispose.
     */
    setEngineDeathObserver(observer: ((event: EngineDeathEvent) => void) | undefined): void;
    /**
     * registerSudoObserver reserves `key`'s slot (the runLogKey rule every run
     * path shares) for the callback one run registers to hear that a sudo
     * command is waiting for the user's password on the CLI: the observer
     * writes the note line into its own run's Logs so the card user learns
     * where the prompt landed. Registering a key that is taken replaces the
     * old hook, and the returned disposer removes only its own hook, so
     * concurrent runs never clobber each other's note routing and a settle
     * never clears another run's slot.
     */
    registerSudoObserver(key: string, observer: (command: string) => void): () => void;
    /**
     * notifySudoNeeded is the seam a command runner reports a waiting sudo
     * prompt through: a guarded runner calls it when its probe finds no cached
     * credentials, and the service forwards the command to every observer the
     * runs registered (the shared CLI password wait can block any run, and
     * the announce seam does not name the triggering run). No observer, or a
     * throwing one, never fails the run that is already racing the sudo
     * deadline.
     */
    notifySudoNeeded(command: string): void;
    /**
     * beginRun starts one provider process's run under `key` (the runLogKey
     * rule every run path shares): the live buffer resets to the `seed` line
     * (the `--- <process>...` separator), the running flag goes true, the
     * monotone seq restarts, and subscribers get a reset notice so a mid-run
     * attached reader replaces rather than appends.
     */
    beginRun(key: string, seed: string): void;
    /**
     * appendRunLog appends one chunk to `key`'s live buffer (tail-capped to
     * LOG_TAIL_BYTES) and notifies subscribers with the chunk. Appending with
     * no open run opens one lazily without a seed, so a note that lands after
     * a settled run (an engine-death line, for example) still reaches the
     * Logs.
     */
    appendRunLog(key: string, text: string): void;
    /**
     * readRunLog answers `key`'s catch-up snapshot (mid-run page refresh,
     * late pane open): the seq reached, the bounded tail text, and the
     * running flag. A key that never ran reads as an empty stopped snapshot.
     */
    readRunLog(key: string): RunLogSnapshot;
    /**
     * subscribeRunLog registers a listener for `key`'s RunLogEvents (appends,
     * run begin, run end) and returns the disposer. Listeners are independent
     * per connection; a slow or closed connection never blocks a writer.
     */
    subscribeRunLog(key: string, listener: RunLogListener): () => void;
    /**
     * endRun clears `key`'s running flag and emits the end event. The text
     * stays readable (readRunLog) until the next beginRun for that key. An
     * end on a key with no open run is a no-op.
     */
    endRun(key: string): void;
    registerModel(plan: LaunchPlan, model: ModelRow, options?: RegisterModelOptions): Promise<RegisterResult>;
    removeModel(providerId: string, modelId: string): Promise<void>;
    resolveDefaults(engineId: string, modelId: string, hw: HardwareProfile, explicit?: Config): Promise<ResolvedDefaults>;
    fetchPreset(source: PresetSource, options?: FetchPresetOptions): Promise<FetchPresetResult>;
    defaultModelDirectory(): string;
    defaultDatasetDirectory(): string;
    hfCliAvailable(options?: HfCliOptions): Promise<string | null>;
    downloadModel(entry: DefaultModel, directory: string, options?: DownloadModelOptions): Promise<DownloadResult>;
    downloadChatTemplate(repo: string, directory: string, options?: DownloadModelOptions): Promise<DownloadResult>;
    modelIsRegistered(providerId: string, modelId: string): Promise<boolean>;
    listModelDirectory(directory: string): ModelDirectoryEntry[];
    listModelCache(): ModelCacheEntry[];
}
//# sourceMappingURL=types.d.ts.map
