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
import { exec, execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, homedir, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { AGENT_DEFAULT_MODEL_NAMESPACE, agentDefaultOps, agentDefaultPointsAt, agentDefaultUnsetOps, buildModelEntry, detectHardware as detectHardwareFromProbes, detectPackageManager, evaluateGuidelines, estimateVram, hfChatTemplateCommand, hfDownloadCommand, isGpuBusy, LLM_PI_AI_NAMESPACE, matchLaunchSignature, modelGuidelines, reLinkRecord, computeProviderStatuses, modelRowsFrom, parseNvidiaSmiGpu, parseNvidiaSmiGpuUsage, planDepsForOs, presetFromFetch, providerRegistrationOps, providerRemovalOps, removeModelRow, renderInstallString, resolveDefaults as resolveDefaultsFromPresets, resolveOsReserve, runInstall, } from '../../core/lib/index.js';
/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_INVALID_MODEL`, `LOCAL_INFER_SETTINGS_UNAVAILABLE`) that
 * callers route on instead of parsing the message.
 */
export class LocalInferError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'LocalInferError';
        this.code = code;
    }
}
/**
 * The probe timeout. A hung nvidia-smi or docker must not hang the panel, so
 * every probe command is killed after this many milliseconds and read as
 * "not available" instead.
 */
const PROBE_TIMEOUT_MS = 5000;
/**
 * The adopted-process poll interval. A re-adopted engine (a surviving process
 * with no ChildProcess after a DSH restart) is watched for death through a
 * liveness probe on this cadence: fast enough that a pkill settles the
 * provider's state within seconds, slow enough that a signal-0 send per
 * watched engine is free.
 */
const PROCESS_WATCH_MS = 5000;
/**
 * `ctx.localInfer`. Holds the engine, preset, guideline, and VramModel
 * reservations; the registries are read per call so a provider that unloads
 * mid-session stops serving without leaving a stale route behind.
 */
export class LocalInfer extends Service {
    engineRegistry = new Map();
    presetRegistry = new Map();
    guidelineRegistry = new Map();
    vramModelRegistry = new Map();
    depPlanRegistry = new Map();
    platformConfigRegistry = new Map();
    // The engine ids this service's launch step started. A plugin-launched
    // engine's footprint is already priced by the estimator, so the OS-reserve
    // resolver keeps its 3 GiB default for it instead of pricing the GPU's
    // used VRAM on top. The set resets on a host restart, which reads as
    // "nothing is plugin-launched" on a fresh start.
    launchedEngines = new Set();
    // The port-to-model map of the engines this service's launch step started.
    // The provider-status detector matches a running engine's port against it to
    // confirm which model a live engine serves: a port the plugin launched reads
    // as that model, a port it did not launch (a foreign engine) has no entry and
    // reads as "engine running, model unknown". The map resets on a host
    // restart, so a fresh start tracks only the launches it made itself. See
    // PLAN.md for the PID-cache note: a full PID cache is a future refinement.
    launchedModels = new Map();
    // The live ports tracked per launched engine (launches and adopted re-links
    // both register). The death handler clears the engine's plugin-launched flag
    // only when its last live port dies, so one provider's engine stopping does
    // not un-flag a second provider's still-running engine on another port.
    launchedPorts = new Map();
    // The poll watchers for processes adopted from stored launch records: a
    // re-adopted engine has no ChildProcess to listen on after a DSH restart, so
    // a liveness poll stands in for the exit event. Keyed by port; the timers
    // are unref'd so a watched engine never keeps the host or a test alive.
    engineWatchers = new Map();
    // The pids whose death this process already watches through a live child
    // handle. A summary re-link that adopts this DSH's own launch record must
    // not stack a poll watcher on top of the handle's close event.
    handledPids = new Set();
    // The engine keys (engineId:port) whose launch this service is in flight
    // for: the deploy has started and the health poll has not settled. While a
    // key is here the provider-status detector keeps the provider's linked read
    // (running, not unsure), so an engine that sizes its own model (Strata, no
    // model tie) or a launch mid-poll never flashes the "Unable to link" banner.
    // The key clears when the launch settles (a healthy poll, a failed deploy).
    launchingEngines = new Set();
    // The engine keys (engineId:port) whose stop this service is in flight for:
    // the stop step signalled the engine and the process has not died yet. While
    // a key is here the detector keeps the linked read, so a stop never reads as
    // an unlinked provider for the moment the engine takes to shut down. The key
    // clears when the process dies (the death observer) or the detector sees the
    // process down (a stop of an engine it cannot watch).
    stoppingEngines = new Set();
    // The route-registered hook for engine process deaths (a crash, a pkill, or
    // a poll-detected death of an adopted process). The observer persists the
    // provider entry's cleared state; a headless profile registers none and the
    // service still settles its own live state.
    deathObserver;
    constructor(ctx) {
        super(ctx, 'localInfer');
    }
    registerEngine(adapter) {
        const id = adapter.id;
        if (id.trim() === '') {
            throw new LocalInferError('an engine adapter id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE');
        }
        if (this.engineRegistry.has(id)) {
            throw new LocalInferError(`an engine adapter with id "${id}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.engineRegistry.set(id, adapter);
            yield () => {
                this.engineRegistry.delete(id);
            };
        }.bind(this), 'localInfer.registerEngine()');
        // ctx.effect's disposer returns Promise<void>; the registry disposer is a
        // synchronous fire-and-forget, so discard the (always-resolved) promise.
        return () => void dispose();
    }
    registerPreset(preset) {
        const key = presetKey(preset);
        if (this.presetRegistry.has(key)) {
            throw new LocalInferError(`a preset for "${key}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.presetRegistry.set(key, preset);
            yield () => {
                this.presetRegistry.delete(key);
            };
        }.bind(this), 'localInfer.registerPreset()');
        return () => void dispose();
    }
    registerGuideline(guideline) {
        if (this.guidelineRegistry.has(guideline.id)) {
            throw new LocalInferError(`a guideline with id "${guideline.id}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.guidelineRegistry.set(guideline.id, guideline);
            yield () => {
                this.guidelineRegistry.delete(guideline.id);
            };
        }.bind(this), 'localInfer.registerGuideline()');
        return () => void dispose();
    }
    registerVramModel(model) {
        const id = model.id;
        if (id.trim() === '') {
            throw new LocalInferError('a VramModel id must be a non-empty string', 'LOCAL_INFER_INVALID_MODEL');
        }
        if (this.vramModelRegistry.has(id)) {
            throw new LocalInferError(`a VramModel with id "${id}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.vramModelRegistry.set(id, model);
            yield () => {
                this.vramModelRegistry.delete(id);
            };
        }.bind(this), 'localInfer.registerVramModel()');
        return () => void dispose();
    }
    registeredEngines() {
        return [...this.engineRegistry.values()];
    }
    registeredPresets() {
        return [...this.presetRegistry.values()];
    }
    registeredGuidelines() {
        return [...this.guidelineRegistry.values()];
    }
    registeredVramModels() {
        return [...this.vramModelRegistry.values()];
    }
    /**
     * registerDepPlan reserves the per-engine dep plan (the docker and local
     * SystemDep lists the providers ship as data). The deps entry point asks a
     * registered adapter's systemDeps first and falls back to this plan for the
     * engine id, so an adapter that declares its own toolchain wins.
     */
    registerDepPlan(engineId, plan) {
        if (engineId.trim() === '') {
            throw new LocalInferError('a dep plan engine id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE');
        }
        if (this.depPlanRegistry.has(engineId)) {
            throw new LocalInferError(`a dep plan for engine "${engineId}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.depPlanRegistry.set(engineId, plan);
            yield () => {
                this.depPlanRegistry.delete(engineId);
            };
        }.bind(this), 'localInfer.registerDepPlan()');
        return () => void dispose();
    }
    registeredDepPlans() {
        return this.depPlanRegistry;
    }
    /**
     * launchedEngineIds lists the engine ids this service's launch step
     * started and has not stopped. The OS-reserve resolver reads the list to
     * keep the 3 GiB default for a plugin-launched engine, whose footprint the
     * estimator already prices.
     */
    launchedEngineIds() {
        return [...this.launchedEngines];
    }
    /**
     * registerEnginePlatformConfig stores the per-engine platform config (the
     * Engine Directory and Engine Fork the user adds for a specific engine). The
     * launch and deploy steps resolve it against the global modelDirectory to
     * produce the clone/build/download plan. A duplicate id replaces the stored
     * config, because a user editing the fields for an engine re-saves the whole
     * config rather than reserving a second slot.
     */
    registerEnginePlatformConfig(config) {
        const id = config.engineId;
        if (id.trim() === '') {
            throw new LocalInferError('an engine platform config id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE');
        }
        this.platformConfigRegistry.set(id, config);
        return () => {
            this.platformConfigRegistry.delete(id);
        };
    }
    /**
     * enginePlatformConfig reads the stored platform config for an engine id, or
     * undefined when none is stored, which the deploy step reads as "use the
     * adapter's default source and a managed cache directory".
     */
    enginePlatformConfig(engineId) {
        return this.platformConfigRegistry.get(engineId);
    }
    /**
     * estimate prices a config against the resolved VramModel and the detected
     * hardware. The OS reserve resolves dynamically (the Phase 10 order:
     * explicit config value, then the plugin-launched / foreign-process /
     * GPU-usage probes), so the meter, the verdict, and the DSH contextWindow
     * all price the same usable budget. The result carries the reserve's
     * source, so the meter's readout names where the number came from.
     */
    async estimate(config, hw, engineId) {
        const model = this.resolveVramModel(config);
        const reserve = await this.resolveReserveFor(config, engineId);
        const estimate = estimateVram(model, config, hw, undefined, { osReserveMiB: reserve.reserveMiB });
        return {
            breakdown: estimate.breakdown,
            verdict: estimate.verdict,
            source: estimate.source,
            reserveSource: reserve.source,
        };
    }
    /**
     * detectHardware runs the host probes (nvidia-smi, docker, WSL2, OS, CPU,
     * RAM) and turns their results into the HardwareProfile every relationship
     * consumes. A probe that fails or times out degrades to "not available"
     * for that capability, so detection never throws on a bare host.
     */
    async detectHardware() {
        const probes = await runHardwareProbes();
        return detectHardwareFromProbes(probes);
    }
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
    async detectOsReserve(config, options) {
        const engineId = options?.engineId;
        const pluginLaunched = engineId !== undefined && this.launchedEngines.has(engineId);
        const signatures = this.collectLaunchSignatures(config);
        let foreignProcess = false;
        if (!pluginLaunched) {
            const processes = options?.processes !== undefined
                ? options.processes
                : await probeProcesses(signatures.map(signature => signature.binary));
            for (const signature of signatures) {
                if (processes.some(line => matchLaunchSignature(line, signature))) {
                    foreignProcess = true;
                    break;
                }
            }
        }
        const gpuUsage = options?.gpuUsage !== undefined ? options.gpuUsage : await probeGpuUsage();
        return resolveOsReserve({ pluginLaunched, foreignProcess, gpuUsage });
    }
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
    async providerStatuses(providers, options) {
        const signatures = providers.map((provider) => {
            const adapter = this.engineRegistry.get(provider.engine);
            return adapter?.launchSignature?.(provider.config ?? {});
        });
        const markers = [];
        for (const signature of signatures) {
            if (signature !== undefined && !markers.includes(signature.binary)) {
                markers.push(signature.binary);
            }
        }
        const processes = options?.processes !== undefined ? options.processes : await probeProcesses(markers);
        const running = [];
        const pricedSignatures = new Set();
        for (const [index, provider] of providers.entries()) {
            const signature = signatures[index];
            if (signature === undefined)
                continue;
            // Two providers sharing one (binary, port) signature price one probe:
            // the first provider's running entry answers for both.
            const signatureKey = `${signature.binary}|${signature.port ?? ''}`;
            if (pricedSignatures.has(signatureKey))
                continue;
            pricedSignatures.add(signatureKey);
            const match = processes.find((line) => matchLaunchSignature(line, signature));
            if (match === undefined)
                continue;
            const entry = { engineId: provider.engine };
            if (signature.port !== undefined) {
                entry.port = signature.port;
                const launched = this.launchedModels.get(signature.port);
                if (launched !== undefined && launched.engineId === provider.engine) {
                    entry.modelId = launched.modelId;
                }
            }
            running.push(entry);
        }
        const gpuUsage = options?.gpuUsage !== undefined ? options.gpuUsage : await probeGpuUsage();
        // The provider's resolved port rides into the resolver so two configs of
        // one engine on different ports confirm only against the engine running
        // on their own port.
        const priced = providers.map((provider, index) => {
            const port = signatures[index]?.port;
            return port !== undefined ? { ...provider, port } : provider;
        });
        const statuses = computeProviderStatuses({ providers: priced, running, gpuBusy: isGpuBusy(gpuUsage) });
        // The in-flight launch and stop state machine: a provider the launch or
        // stop step is in flight for keeps its linked read (running, not unsure)
        // while the engine process is still up, so neither a stop (the record is
        // cleared but the process is still shutting down) nor a launch (an engine
        // that sizes its own model carries no model tie) flashes the "Unable to
        // link" banner. A stopped provider whose process is down reads as stopped,
        // and the stopping flag clears with it, so a stop of an engine the service
        // cannot watch (no death event) never leaves a stale flag behind.
        for (const provider of priced) {
            const key = this.engineKey(provider.engine, provider.port);
            const launching = this.launchingEngines.has(key);
            const stopping = this.stoppingEngines.has(key);
            if (!launching && !stopping)
                continue;
            if (statuses[provider.id] === 'unsure') {
                statuses[provider.id] = 'running';
            }
            else if (stopping) {
                this.stoppingEngines.delete(key);
            }
        }
        return statuses;
    }
    /**
     * unsureBannerKillCommands returns the bash kill commands for the engine
     * processes the detector saw holding VRAM, for the "unsure" banner the card
     * shows when no provider is confirmed running but at least one reads as
     * unsure. A process is included when its command line carries an engine
     * binary marker and the card's VRAM usage is above 30% of the total (the
     * threshold below which a foreign engine is not considered to be holding
     * the card). The commands are one `kill <pid>` per matching process, in
     * pid order. An empty list means no matching process was seen, so the
     * banner's text area renders empty.
     */
    async unsureBannerKillCommands(options) {
        const markers = [];
        for (const adapter of this.engineRegistry.values()) {
            const signature = adapter.launchSignature?.();
            if (signature !== undefined)
                markers.push(signature.binary);
        }
        const processes = options?.processes !== undefined ? options.processes : await probeProcesses(markers);
        const gpuUsage = options?.gpuUsage !== undefined ? options.gpuUsage : await probeGpuUsage();
        // The 30% threshold: below it the card is not busy enough to attribute
        // to a foreign engine, so no kill command is offered.
        if (gpuUsage === null ||
            gpuUsage === undefined ||
            gpuUsage.totalMiB <= 0 ||
            gpuUsage.usedMiB / gpuUsage.totalMiB < 0.3) {
            return [];
        }
        const commands = [];
        for (const line of processes) {
            if (markers.some((marker) => line.command.includes(marker))) {
                commands.push(`kill ${line.pid}`);
            }
        }
        return commands;
    }
    /**
     * guidelines runs the full guideline engine over a config and a hardware
     * profile: the registered named guidelines, every per-spec hardware
     * constraint of the registered engines, and the model-aware rules that
     * price against the resolved VramModel (the estimator-backed "exceeds
     * usable VRAM" and "spec needs draft weights" rules). The result list is
     * the single source the UI banner and the inline red warnings render from.
     */
    async guidelines(config, hw, engineId) {
        const results = evaluateGuidelines(this.registeredGuidelines(), this.collectSpecs(), config, hw);
        const model = this.resolveVramModel(config);
        if (model !== undefined) {
            // The model-aware rules price the same usable budget the estimate
            // does, so the red "exceeds VRAM" warning and the meter verdict agree.
            const reserve = await this.resolveReserveFor(config, engineId);
            for (const result of modelGuidelines(model, config, hw, { osReserveMiB: reserve.reserveMiB })) {
                results.push(result);
            }
        }
        return results;
    }
    /**
     * deps resolves the host deps an engine's deploy step needs for a build
     * mode. A registered adapter that declares systemDeps wins; the provider-
     * registered plan for the engine id is the fallback, and an engine with
     * neither plans an empty list (nothing to install, the gate passes).
     */
    async deps(engineId, buildMode, hw) {
        const adapter = this.engineRegistry.get(engineId);
        if (adapter !== undefined && typeof adapter.systemDeps === 'function') {
            return adapter.systemDeps(buildMode, hw);
        }
        const plan = this.depPlanRegistry.get(engineId);
        if (plan === undefined)
            return [];
        // The plan's base lists are the Linux/WSL lists; a Windows host reads the
        // plan's windows variant for the mode when present, so the System
        // dependencies section shows the winget toolchain on Windows.
        return planDepsForOs(plan, buildMode, hw.os);
    }
    /**
     * installString renders the copy/paste block for the resolved dep plan,
     * keyed to the detected package manager, with the by-hand note for a dep
     * the manager has no commands for.
     */
    async installString(engineId, buildMode, hw) {
        const deps = await this.deps(engineId, buildMode, hw);
        return renderInstallString(deps, hw);
    }
    /**
     * runInstall is the Play/Run path: it runs the resolved dep plan's commands
     * through the shell runner and re-probes each dep. The runner captures the
     * per-command exit, so a failure names the command that broke.
     */
    async runInstall(engineId, buildMode, hw) {
        const deps = await this.deps(engineId, buildMode, hw);
        return runInstall(deps, hw, shellRunCommand);
    }
    /**
     * launch is the lifecycle entry point: it resolves the adapter that rendered
     * the plan (by the plan's engineId), runs the adapter's deploy step (build
     * or pull, download the model, start the engine) with the stored platform
     * config, then polls the health URL until the engine reports 200. A deploy
     * failure or a health timeout reads as not-healthy with the detail, so the
     * UI shows the broken step rather than a blank panel.
     */
    async launch(plan, options) {
        const adapter = this.engineRegistry.get(plan.engineId);
        if (adapter === undefined) {
            throw new LocalInferError(`no engine adapter is registered for "${plan.engineId}"`, 'LOCAL_INFER_INVALID_ENGINE');
        }
        const platform = this.platformConfigRegistry.get(plan.engineId);
        // The deploy step reports its download and build sub-steps through the
        // progress sink, so the card's button reads the phase that is running.
        const onProgress = options?.onProgress;
        // The trust gate and the auto-rebuild flag ride into the deploy step,
        // which reads them to decide whether a rebuild's missing-binary symlink
        // runs (gate on) or is written to the card's Logs section (off), and
        // whether the git sync (fetch, rebase, rebuild) runs at all.
        // exactOptionalPropertyTypes: only pass the option object when a key is
        // present.
        const hasDeployOptions = options?.allowRunDeps !== undefined || options?.autoRebuild !== undefined;
        const deployOptions = hasDeployOptions
            ? {
                ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
                ...(options?.autoRebuild !== undefined ? { autoRebuild: options.autoRebuild } : {}),
            }
            : undefined;
        // The in-flight launch flag: the provider-status detector keeps this
        // provider's linked read while the deploy and health poll run, so an engine
        // that sizes its own model (no model tie) never flashes "Unable to link".
        const launchKey = this.engineKey(plan.engineId, plan.port);
        this.launchingEngines.add(launchKey);
        const deployResult = await adapter.deploy(plan, platform, onProgress, deployOptions);
        if (!deployResult.ok) {
            // A failed deploy settles the launch: clear the in-flight flag so the
            // provider reads from the process state (stopped), not a stuck launch.
            this.launchingEngines.delete(launchKey);
            // exactOptionalPropertyTypes: only write the detail key when it is present.
            const result = { plan, healthy: false };
            if (deployResult.detail !== undefined) {
                result.detail = deployResult.detail;
            }
            // A failed deploy still carries the build decision and output it captured,
            // so the card's Logs section shows the step that broke.
            if (deployResult.logs !== undefined && deployResult.logs !== '') {
                result.logs = deployResult.logs;
            }
            return result;
        }
        // A successful deploy means the engine process is running, so the
        // OS-reserve resolver keeps the 3 GiB default for it: its footprint is
        // already priced by the estimator, and pricing the GPU's used VRAM on
        // top would double-count.
        this.launchedEngines.add(plan.engineId);
        if (plan.port !== undefined) {
            // A fresh launch on a port replaces any adopted-process watcher left
            // over from the engine this launch displaced on that port.
            this.stopEngineWatcher(plan.port);
            const ports = this.launchedPorts.get(plan.engineId) ?? new Set();
            ports.add(plan.port);
            this.launchedPorts.set(plan.engineId, ports);
        }
        // The provider-status detector ties a running engine's port to the model
        // the plugin launched it with, so a live engine the plugin started reads
        // as that model (green) rather than "engine running, model unknown".
        if (plan.modelId !== undefined && plan.port !== undefined) {
            this.launchedModels.set(plan.port, { engineId: plan.engineId, modelId: plan.modelId });
        }
        // The exit watch attaches before the health poll, so an engine that
        // crashes mid-startup (or is pkill'd during the poll) settles the live
        // state and reaches the death observer instead of leaving the port tied
        // to a model that is no longer serving.
        if (deployResult.handle !== undefined) {
            this.watchLaunchedHandle(deployResult.handle, plan);
        }
        // The health poll is the launch phase: the rebuild (download, build) is
        // done and the engine process is up, so the card's button reads
        // "Launching..." while it waits for the engine to report ready.
        onProgress?.('launch');
        const health = await adapter.healthCheck(plan, options);
        // The launch has settled (a healthy poll, a failed one, or a download that
        // the card re-polls): clear the in-flight flag so the provider reads from
        // the model tie (a healthy launch) or the process state (a failed one).
        this.launchingEngines.delete(launchKey);
        const launchResult = { plan, healthy: health.healthy };
        if (health.detail !== undefined) {
            launchResult.detail = health.detail;
        }
        // The start phase the poll observed (downloading, starting, ready, failed)
        // rides the result so the card reads a long model download as in progress
        // instead of a broken launch.
        if (health.state !== undefined) {
            launchResult.state = health.state;
        }
        // The launch record the route persists for the provider config entry: the
        // engine's pid and the DSH process pid that launched it. The parent pid is
        // only written when the host process identifies as DSH, so a non-DSH host
        // never claims an engine it did not launch (the re-link rule reads a
        // missing parent as foreign after a restart).
        const handlePid = deployResult.handle?.pid;
        if (handlePid !== undefined && handlePid > 0) {
            launchResult.pid = handlePid;
            if (dshProcessIdentifies(process.pid)) {
                launchResult.parentPid = process.pid;
            }
        }
        // Read the engine's captured output after the health poll, so the result
        // carries the log lines the engine printed while it came up. The deploy
        // step's own captured output (the rebuild decision, the build command, and
        // its output) is kept separate in buildLogs, so the route orders the launch
        // command after a build (or a direct launch) and before the engine output.
        const buildLogs = deployResult.logs ?? '';
        const handleLogs = deployResult.handle?.logs ?? '';
        if (buildLogs !== '') {
            launchResult.buildLogs = buildLogs;
        }
        if (handleLogs !== '') {
            launchResult.logs = handleLogs;
        }
        return launchResult;
    }
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
    async reLinkProviders(entries, options) {
        const processAlive = options?.processAlive ?? isProcessAlive;
        const commandLine = options?.commandLine ?? readProcessCommandLine;
        const outcomes = {};
        for (const entry of entries) {
            const outcome = reLinkRecord({
                record: entry.record,
                currentDshPid: process.pid,
                processAlive,
                commandLine,
            });
            outcomes[entry.id] = outcome;
            if (outcome === 'adopted') {
                // The re-adopted engine is plugin-launched again, so the OS-reserve
                // resolver keeps its 3 GiB default and the provider-status detector
                // ties its port to the model the record names.
                this.launchedEngines.add(entry.record.engineId);
                if (entry.record.port !== undefined) {
                    const ports = this.launchedPorts.get(entry.record.engineId) ?? new Set();
                    ports.add(entry.record.port);
                    this.launchedPorts.set(entry.record.engineId, ports);
                    if (entry.record.modelId !== undefined) {
                        this.launchedModels.set(entry.record.port, {
                            engineId: entry.record.engineId,
                            modelId: entry.record.modelId,
                        });
                    }
                    // Re-attach the exit watch the restart dropped: the adopted child
                    // has no ChildProcess to listen on, so the poll stands in and the
                    // death settles the state the same way a live child's close event
                    // does. A repeat summary call keeps the existing watcher.
                    this.watchAdoptedEngine(entry.record, processAlive);
                }
            }
        }
        return outcomes;
    }
    /**
     * setEngineDeathObserver registers the route's hook for engine process
     * deaths: a crash or pkill seen through a launched handle's exit event, or a
     * poll-detected death of a process adopted from a stored launch record. The
     * observer persists the provider entry's cleared state so the card reads the
     * provider stopped instead of carrying a stale record. Passing undefined
     * clears it, which the route's effect does on dispose.
     */
    setEngineDeathObserver(observer) {
        this.deathObserver = observer;
    }
    /**
     * watchLaunchedHandle ties a launched child's one-shot exit to the live
     * state: the host's close/error event (a crash, a pkill, or the stop kill)
     * reports through observeEngineDeath. A handle whose host cannot watch (no
     * onExit, a stub) is left to the re-link rule to price after a restart.
     */
    watchLaunchedHandle(handle, plan) {
        if (typeof handle.onExit !== 'function')
            return;
        if (handle.pid > 0) {
            this.handledPids.add(handle.pid);
        }
        handle.onExit((exit) => {
            this.handledPids.delete(handle.pid);
            this.observeEngineDeath({
                engineId: plan.engineId,
                ...(plan.port !== undefined ? { port: plan.port } : {}),
                ...(plan.modelId !== undefined ? { modelId: plan.modelId } : {}),
                ...(handle.pid > 0 ? { pid: handle.pid } : {}),
                code: exit.code,
                signal: exit.signal,
                ...(exit.error !== undefined ? { detail: exit.error } : {}),
            });
        });
    }
    /**
     * watchAdoptedEngine re-attaches the exit watch for a process this DSH did
     * not spawn: a surviving engine adopted from a stored launch record has no
     * ChildProcess to listen on after a restart, so an unref'd poll on the
     * liveness probe stands in for the exit event. When the pid dies the watcher
     * stops itself and reports through observeEngineDeath, so the provider's
     * state settles without waiting for the next summary re-link to price the
     * record dead.
     */
    watchAdoptedEngine(record, processAlive) {
        if (record.port === undefined)
            return;
        if (this.engineWatchers.has(record.port))
            return;
        // A launch this DSH made itself already has the child handle's close
        // event; a poll watcher would only double-report the same death.
        if (this.handledPids.has(record.pid))
            return;
        const port = record.port;
        const timer = setInterval(() => {
            if (processAlive(record.pid))
                return;
            this.observeEngineDeath({
                engineId: record.engineId,
                port,
                ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
                pid: record.pid,
                code: null,
                signal: null,
                detail: 'the adopted engine process exited outside this DSH session',
            });
        }, PROCESS_WATCH_MS);
        timer.unref();
        this.engineWatchers.set(port, { pid: record.pid, timer });
    }
    /**
     * engineKey is the in-flight state machine's key for one engine: the engine
     * id plus its port when the plan names one, so two configs of one engine on
     * different ports are distinct engines. A plan with no port keys on the
     * engine id alone.
     */
    engineKey(engineId, port) {
        return port !== undefined ? `${engineId}:${port}` : engineId;
    }
    /**
     * stopEngineWatcher cancels one port's adopted-process poll, if it has one.
     */
    stopEngineWatcher(port) {
        const watcher = this.engineWatchers.get(port);
        if (watcher === undefined)
            return;
        clearInterval(watcher.timer);
        this.engineWatchers.delete(port);
    }
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
    observeEngineDeath(event) {
        if (event.port !== undefined) {
            // The process is down: the in-flight stop (if one was in flight) has
            // settled, so drop the flag and the deferred port-to-model tie the stop
            // step kept for the provider's linked read.
            this.stoppingEngines.delete(this.engineKey(event.engineId, event.port));
            const tracked = this.launchedModels.get(event.port);
            if (tracked !== undefined && tracked.engineId === event.engineId) {
                this.launchedModels.delete(event.port);
            }
            this.stopEngineWatcher(event.port);
            const ports = this.launchedPorts.get(event.engineId);
            if (ports !== undefined) {
                ports.delete(event.port);
                if (ports.size === 0) {
                    this.launchedPorts.delete(event.engineId);
                }
            }
        }
        const remaining = event.port !== undefined ? this.launchedPorts.get(event.engineId) : undefined;
        if (remaining === undefined || remaining.size === 0) {
            this.launchedEngines.delete(event.engineId);
        }
        this.deathObserver?.(event);
    }
    /**
     * stop signals the engine a launch started: it resolves the adapter by the
     * plan's engineId and runs the adapter's stop step (kill the tracked process,
     * stop the named container, or compose down).
     */
    async stop(plan) {
        const adapter = this.engineRegistry.get(plan.engineId);
        if (adapter === undefined) {
            throw new LocalInferError(`no engine adapter is registered for "${plan.engineId}"`, 'LOCAL_INFER_INVALID_ENGINE');
        }
        // The in-flight stop flag: the provider-status detector keeps this
        // provider's linked read while the engine shuts down, so a stop never
        // flashes the "Unable to link" banner for the moment the process takes to
        // die. The flag clears when the process dies (the death observer) or the
        // detector sees the process down (a stop of an engine it cannot watch).
        this.stoppingEngines.add(this.engineKey(plan.engineId, plan.port));
        await adapter.stop(plan);
        // Clear the live-port ledger and the plugin-launched flag, and cancel any
        // adopted-process watcher standing on the port. The port-to-model tie is
        // deferred to the death observer, so the provider keeps its linked read
        // (running, not unsure) for the moment the engine is still shutting down;
        // the observer drops it the instant the process is down.
        if (plan.port !== undefined) {
            this.stopEngineWatcher(plan.port);
            const ports = this.launchedPorts.get(plan.engineId);
            if (ports !== undefined) {
                ports.delete(plan.port);
                if (ports.size === 0) {
                    this.launchedPorts.delete(plan.engineId);
                }
            }
            // The engine is no longer plugin-launched only when it has no other
            // live port: a second provider's engine on another port keeps the
            // OS-reserve default.
            const remaining = this.launchedPorts.get(plan.engineId);
            if (remaining === undefined || remaining.size === 0) {
                this.launchedEngines.delete(plan.engineId);
            }
        }
        else {
            // A plan with no port (a compose profile the stop step signalled down)
            // clears the flag outright.
            this.launchedEngines.delete(plan.engineId);
        }
    }
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
    async registerModel(plan, model, options) {
        const settings = this.settings();
        const entry = buildModelEntry(plan, model);
        const llm = await this.descriptor(settings, LLM_PI_AI_NAMESPACE);
        const rows = modelRowsFrom(llm?.value, entry.providerId);
        await this.mutateSettings(settings, LLM_PI_AI_NAMESPACE, providerRegistrationOps(entry, rows), llm?.revision);
        if (options?.agentDefault === true) {
            const agent = await this.descriptor(settings, AGENT_DEFAULT_MODEL_NAMESPACE);
            await this.mutateSettings(settings, AGENT_DEFAULT_MODEL_NAMESPACE, agentDefaultOps(entry.providerId, model.id), agent?.revision);
        }
        return { ok: true, entry };
    }
    /**
     * removeModel removes a registered model from its provider: the models
     * list without the row, the whole provider when the row was the last one,
     * and the agent default section cleared when it pointed at the removed
     * pair. Removing a model the provider does not carry is a no-op, so a
     * stop with nothing registered stays quiet.
     */
    async removeModel(providerId, modelId) {
        const settings = this.settings();
        const llm = await this.descriptor(settings, LLM_PI_AI_NAMESPACE);
        const rows = modelRowsFrom(llm?.value, providerId);
        // A provider the section does not carry removes nothing: a stop with
        // nothing registered stays quiet, so no write and no revision bump.
        if (rows.length > 0) {
            const ops = providerRemovalOps(providerId, removeModelRow(rows, modelId));
            await this.mutateSettings(settings, LLM_PI_AI_NAMESPACE, ops, llm?.revision);
        }
        const agent = await this.descriptor(settings, AGENT_DEFAULT_MODEL_NAMESPACE);
        if (agent !== undefined && agentDefaultPointsAt(agent.value, providerId, modelId)) {
            await this.mutateSettings(settings, AGENT_DEFAULT_MODEL_NAMESPACE, agentDefaultUnsetOps(), agent.revision);
        }
    }
    /**
     * resolveDefaults resolves the starting Config for an engine, model, and
     * detected hardware over the registered presets and the engine's parameter
     * surface. The resolution order (explicit value, exact-class preset,
     * built-in preset, spec default) and the per-key provenance are the core
     * resolver's, so the meter, the form, and the DSH contextWindow all price
     * the same starting config.
     */
    async resolveDefaults(engineId, modelId, hw, explicit) {
        const specs = this.specsForEngine(engineId);
        return resolveDefaultsFromPresets(this.registeredPresets(), specs, engineId, modelId, hw, explicit);
    }
    /**
     * fetchPreset is the mod-search fetch path: it runs the bridge over the
     * source's URL, extracts the values with the source's pure extractor, tags
     * the result with the URL and the fetch date, persists it to the preset
     * store, and registers it so the next resolveDefaults uses it. When the
     * bridge is unavailable (no CLI, a failed fetch) it degrades to a
     * not-stored, degraded answer so the caller falls back to the built-in
     * presets and says so.
     */
    async fetchPreset(source, options) {
        const cliPath = await this.resolveModsearchCli(options?.cliPath);
        if (cliPath === null) {
            return {
                preset: undefined,
                stored: false,
                degraded: true,
                detail: 'the modsearch CLI is not available; the built-in presets apply',
            };
        }
        let content;
        try {
            content = await this.fetchPage(source.url, cliPath);
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            return {
                preset: undefined,
                stored: false,
                degraded: true,
                detail: `the modsearch fetch failed: ${detail}; the built-in presets apply`,
            };
        }
        const preset = presetFromFetch(source, content, todayIso());
        this.storePreset(preset);
        this.registerIfNew(preset);
        return { preset, stored: true, degraded: false };
    }
    /**
     * defaultModelDirectory is the plugin's model download directory: under
     * the dsh home so a web user and a CLI user share one location, the way the
     * config file does. The directory is created when absent, so the field's
     * default is always a real path the deploy step can target.
     */
    defaultModelDirectory() {
        const directory = join(homedir(), '.dsh', 'models');
        mkdirSync(directory, { recursive: true });
        return directory;
    }
    /**
     * hfCliAvailable probes for the hf CLI the model download runs: an
     * injected cliPath wins, then the `hf` binary on PATH. None found reads as
     * null, which the card renders as the no-CLI row with the model URL.
     */
    async hfCliAvailable(options) {
        const injected = options?.cliPath;
        if (injected !== undefined && injected.trim() !== '')
            return injected;
        // The presence probe is `which` on Linux/macOS and `where` on Windows, so
        // an installed hf CLI is found on every host.
        const probe = platform() === 'win32' ? 'where' : 'which';
        const which = await runCommand(probe, ['hf']);
        if (which.ok && which.stdout.trim() !== '')
            return which.stdout.trim();
        return null;
    }
    /**
     * downloadModel runs the hf CLI download for one default model into the
     * model directory: it creates the target directory when absent (the
     * recursive flag covers the parents too), renders the command through the
     * core builder (the single source the card shows), and runs it through the
     * injected runner when one is given, so a test captures the command without
     * a live hf. A failure keeps the runner's detail, so the card names the
     * broken step.
     */
    async downloadModel(entry, directory, options) {
        mkdirSync(directory, { recursive: true });
        const runner = options?.runner ?? downloadRunner;
        const result = await runner(hfDownloadCommand(entry, directory));
        if (result.ok)
            return { ok: true };
        return { ok: false, detail: `model download failed: ${result.detail ?? 'unknown'}` };
    }
    /**
     * downloadChatTemplate pulls the chat template file for one HF repo
     * reference into the model directory, so a selected template (the Froggeric
     * set, a custom repo) works out of the box. It shares the model download's
     * recursive directory creation, runner, and long timeout: a template is a
     * small file, but the hf CLI's cold start and auth are the same cost.
     */
    async downloadChatTemplate(repo, directory, options) {
        mkdirSync(directory, { recursive: true });
        const runner = options?.runner ?? downloadRunner;
        const result = await runner(hfChatTemplateCommand(repo, directory));
        if (result.ok)
            return { ok: true };
        return { ok: false, detail: `chat template download failed: ${result.detail ?? 'unknown'}` };
    }
    /**
     * modelIsRegistered reports whether a provider entry with the named model is
     * already registered in the DSH settings, so the save route can sync the
     * registered model's input types (the vision flag) without duplicating a
     * fresh registration. A provider the section does not carry reads as
     * unregistered.
     */
    async modelIsRegistered(providerId, modelId) {
        const settings = this.settings();
        const llm = await this.descriptor(settings, LLM_PI_AI_NAMESPACE);
        const rows = modelRowsFrom(llm?.value, providerId);
        return rows.some((row) => row.id === modelId);
    }
    /**
     * listModelDirectory lists the top-level entries of a model directory, the
     * data the Model dropdown's directory scan draws from. Dot entries (the
     * `.cache` the hf CLI keeps) never name a model, so they are skipped. A
     * directory entry carries the `hasSafetensors` marker the Hyper-Qwen
     * filter reads: a repo folder with a weight file is a usable local model.
     * A missing or unreadable directory reads as an empty list, which the
     * route renders as "no local models".
     */
    listModelDirectory(directory) {
        let dirents;
        try {
            dirents = readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return [];
        }
        const entries = [];
        for (const dirent of dirents) {
            if (dirent.name.startsWith('.'))
                continue;
            const isDirectory = dirent.isDirectory();
            entries.push({
                name: dirent.name,
                isDirectory,
                ...(isDirectory
                    ? { hasSafetensors: hasSafetensorsIn(join(directory, dirent.name)) }
                    : {}),
            });
        }
        return entries;
    }
    /**
     * specsForEngine reads the parameter surface of the registered adapter for
     * an engine id, so the defaults resolver floors the result on that engine's
     * own spec defaults. An engine no adapter serves floors on an empty
     * surface, which reads as "no spec defaults" rather than a collision.
     */
    specsForEngine(engineId) {
        const adapter = this.engineRegistry.get(engineId);
        if (adapter === undefined)
            return [];
        return adapter.parameters();
    }
    /**
     * resolveModsearchCli finds the modsearch CLI script the fetch path spawns.
     * An injected cliPath wins, then the MODSEARCH_CLI env, then the modsearch
     * bin on PATH. None found reads as the bridge being unavailable, which
     * fetchPreset degrades on.
     */
    async resolveModsearchCli(cliPath) {
        if (cliPath !== undefined && cliPath.trim() !== '')
            return cliPath;
        const env = process.env.MODSEARCH_CLI;
        if (env !== undefined && env.trim() !== '')
            return env;
        // The presence probe is `which` on Linux/macOS and `where` on Windows.
        const probe = platform() === 'win32' ? 'where' : 'which';
        const which = await runCommand(probe, ['modsearch']);
        if (which.ok && which.stdout.trim() !== '')
            return which.stdout.trim();
        return null;
    }
    /**
     * fetchPage runs the modsearch CLI over one URL and reads the fetched page
     * content out of its JSON answer. The CLI's fetch schema carries a
     * `content` string; a non-JSON answer or a nonzero exit reads as a failed
     * fetch, which the caller degrades on.
     */
    fetchPage(url, cliPath) {
        return new Promise((resolve, reject) => {
            const child = spawn('node', [cliPath, 'search', '-u', url, '--deadline', '60000'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', (error) => {
                reject(new Error(`the modsearch CLI failed to start: ${error.message}`));
            });
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        // The CLI's fetch answer nests the page under results[0].content;
                        // a top-level content (a search answer) is read the same way.
                        const parsed = JSON.parse(stdout);
                        const first = parsed.results?.[0];
                        const content = typeof parsed.content === 'string' ? parsed.content : first?.content;
                        resolve(typeof content === 'string' ? content : '');
                    }
                    catch (error) {
                        reject(new Error(`the modsearch CLI returned non-JSON output: ${error.message}`));
                    }
                    return;
                }
                reject(new Error(`the modsearch CLI exited ${code}: ${stderr.trim().slice(-512)}`));
            });
        });
    }
    /**
     * storePreset persists a fetched preset to the preset store, replacing any
     * stored preset with the same (engine, model, class) key so a re-fetch
     * refreshes in place rather than duplicating.
     */
    storePreset(preset) {
        const path = presetStorePath();
        mkdirSync(dirname(path), { recursive: true });
        const key = presetKey(preset);
        const next = this.readPresetStore().filter((entry) => presetKey(entry) !== key);
        next.push(preset);
        writeFileSync(path, JSON.stringify(next, null, 2));
    }
    /**
     * readPresetStore reads the stored presets, degrading a missing or broken
     * file to an empty list so a first fetch starts a fresh store.
     */
    readPresetStore() {
        const path = presetStorePath();
        if (!existsSync(path))
            return [];
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    /**
     * registerIfNew registers a fetched preset with the seam, skipping the
     * write when the preset's key is already reserved, so a re-fetch of a
     * built-in triple does not trip the duplicate-id conflict.
     */
    registerIfNew(preset) {
        if (this.presetRegistry.has(presetKey(preset)))
            return;
        this.registerPreset(preset);
    }
    /**
     * settings narrows the context to the dsh settings service the registrar
     * writes through. A profile without the service (a headless install) fails
     * loudly with a stable code, so a caller never mistakes "no seam" for a
     * published model.
     */
    settings() {
        // Read the dsh settings service through the typert remote `settings`
        // namespace, the seam the Web UI's settings controller exposes. A direct
        // `ctx.settings` read throws "cannot get property without inject" when the
        // seam is absent; the remote accessor returns undefined instead, which the
        // stable code a headless profile should surface.
        // The typert remote accessor is added at runtime by the dsh settings
        // controller, so it is not on the cordis Context type. Cast through
        // unknown to reach it, and read it in a try so a profile without the
        // typert protocol (a headless install) falls through to the stable code.
        // A test context without a typert remote exposes the seam through the
        // reflect store instead, so the reflect lookup is the fallback.
        let remote;
        try {
            remote = this.ctx.remote;
        }
        catch {
            remote = undefined;
        }
        const settings = remote?.settings ?? this.ctx.reflect.get('settings');
        if (settings === undefined) {
            throw new LocalInferError('the dsh settings service is not available in this profile', 'LOCAL_INFER_SETTINGS_UNAVAILABLE');
        }
        return settings;
    }
    /**
     * descriptor reads one settings entry by namespace key. The read requests
     * secret redaction, because the registrar prices the section it edits and
     * a secret value must never ride into the core's pure ops.
     */
    async descriptor(settings, ns) {
        // The dsh settings seam answers describe in three contracts, so the read
        // is awaited and the namespace list unwrapped before the entry is picked:
        // the typert remote envelope carries the result under `value`, a host that
        // predates the envelope answers with the plain object, and the SettingsForms
        // service the reflect fallback reaches answers with the bare descriptor
        // array. Read all three, so the registrar works against any seam.
        const response = await settings.describe({ redactSecrets: true });
        let namespaces;
        if (Array.isArray(response)) {
            namespaces = response;
        }
        else if ('namespaces' in response) {
            namespaces = response.namespaces;
        }
        else {
            namespaces = response.value?.namespaces;
        }
        return namespaces?.find((entry) => entry.ns === ns);
    }
    /**
     * mutateSettings applies a path-addressed edit through the typert remote
     * settings seam and surfaces a refusal as a stable code. The controller
     * classifies provider refusals (a conflict, a rejected write) into the
     * envelope's message, so the registrar reports the reason, not a bare throw.
     */
    async mutateSettings(settings, ns, ops, expectedRevision) {
        const response = await settings.mutate(ns, ops, expectedRevision);
        // A seam that answers with no envelope (a host that predates the typert
        // remote settings namespace) reports a successful write by returning
        // nothing; only a { ok: false, error } envelope is a refusal.
        if (response !== undefined && !response.ok) {
            throw new LocalInferError(response.error?.message ?? 'settings mutation failed', 'LOCAL_INFER_SETTINGS_MUTATE_FAILED');
        }
    }
    /**
     * Picks the VramModel an estimate prices against: the one the config names
     * by `model`, or the single registered model when the config names none.
     * Zero or several candidates with no name leave the estimate not-measured
     * rather than a guess.
     */
    resolveVramModel(config) {
        if (typeof config.model === 'string') {
            return this.vramModelRegistry.get(config.model);
        }
        const models = [...this.vramModelRegistry.values()];
        return models.length === 1 ? models[0] : undefined;
    }
    /**
     * collectLaunchSignatures gathers the launch signatures of every registered
     * adapter for a config, so the OS-reserve probe matches the running process
     * table against each engine's own toArgv/toEnv spelling. An adapter without
     * a signature (one whose engine leaves no host process) contributes none.
     */
    collectLaunchSignatures(config) {
        const signatures = [];
        for (const adapter of this.engineRegistry.values()) {
            const signature = adapter.launchSignature?.(config);
            if (signature !== undefined) {
                signatures.push(signature);
            }
        }
        return signatures;
    }
    /**
     * resolveReserveFor resolves the OS reserve an estimate prices: an explicit
     * config value (reserveMiB or reserveGiB) wins and reads as 'explicit'
     * without running a probe, else the Phase 10 resolution over the probes
     * (the plugin-launched check, the foreign-process match, the GPU-usage
     * reading). The answer is the single source the meter, the verdict, and
     * the DSH contextWindow price.
     */
    async resolveReserveFor(config, engineId) {
        if (typeof config.reserveMiB === 'number' && Number.isFinite(config.reserveMiB)) {
            return { reserveMiB: config.reserveMiB, source: 'explicit' };
        }
        if (typeof config.reserveGiB === 'number' && Number.isFinite(config.reserveGiB)) {
            return { reserveMiB: config.reserveGiB * 1024, source: 'explicit' };
        }
        // exactOptionalPropertyTypes: build the options with only the key that is
        // present, so an absent engine id never writes `undefined`.
        const options = {};
        if (engineId !== undefined) {
            options.engineId = engineId;
        }
        return this.detectOsReserve(config, options);
    }
    /**
     * collectSpecs gathers the parameter surfaces of every registered engine,
     * deduped by key in registration order. A key two engines share (spec,
     * draftTokens, vision) keeps the first engine's spec, so a config warning
     * reads from one surface, not a collision.
     */
    collectSpecs() {
        const seen = new Set();
        const specs = [];
        for (const engine of this.engineRegistry.values()) {
            for (const spec of engine.parameters()) {
                if (seen.has(spec.key))
                    continue;
                seen.add(spec.key);
                specs.push(spec);
            }
        }
        return specs;
    }
}
/**
 * The stable registry key for a preset: its exact (engine, model, hardware
 * class) triple plus its label. A preset is only trusted for the triple it
 * was sourced for, and the label keeps the distinct tiers that share a triple
 * (the Hyper-Qwen speed, long-context, and huge-context presets) from
 * collapsing into one key.
 */
function presetKey(preset) {
    return `${preset.engineId}/${preset.modelId}/${preset.hardwareClass}/${preset.label ?? ''}`;
}
/**
 * presetStorePath is where fetched presets persist: under the dsh home so a
 * web user and a CLI user share one store, the way the config file does.
 */
function presetStorePath() {
    return join(homedir(), '.dsh', 'local-infer', 'presets.json');
}
/**
 * todayIso is the fetch date a fetched preset is tagged with, in the
 * YYYY-MM-DD form the UI renders beside the source.
 */
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
/**
 * runCommand runs one probe command and reports whether it exited clean. A
 * missing binary or a timeout reads as not-ok, which the probes map to the
 * "capability not available" state.
 */
function runCommand(cmd, args) {
    return new Promise(resolve => {
        execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
            resolve({ ok: error === null, stdout: stdout ?? '' });
        });
    });
}
/**
 * The tail of the output the shell runner keeps on a failure. The full log
 * of a CUDA toolkit download is noise in a UI note; the last kilobyte names
 * the broken line.
 */
const INSTALL_OUTPUT_TAIL = 1024;
/**
 * shellRunCommand is the Play/Run runner: it runs one command line through
 * the system shell and reports the exit. stdin is closed, so a sudo password
 * prompt that cannot read a terminal fails fast instead of hanging the panel;
 * the copy/paste path is the fallback the plan names for exactly this.
 */
const shellRunCommand = (command) => new Promise(resolve => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = (chunk) => {
        output += chunk.toString('utf8');
        if (output.length > INSTALL_OUTPUT_TAIL * 2) {
            output = output.slice(-INSTALL_OUTPUT_TAIL * 2);
        }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    // Without a listener, a child that fails to start (a missing shell) emits
    // an unlistened 'error' and throws it as an uncaughtException through the
    // host. Read it as a failed command instead.
    child.on('error', (error) => {
        resolve({ ok: false, detail: error.message });
    });
    child.on('close', code => {
        if (code === 0) {
            resolve({ ok: true });
            return;
        }
        resolve({ ok: false, detail: `exit ${code}: ${output.trim().slice(-INSTALL_OUTPUT_TAIL)}` });
    });
});
/**
 * The download timeout. A model download moves tens of GiB, so the cap is
 * hours, not the probe's seconds; a hung download must not kill the panel,
 * only the command.
 */
const DOWNLOAD_TIMEOUT_MS = 7_200_000;
/**
 * downloadRunner is the model-download runner: it runs the rendered hf CLI
 * command through the system shell and reports the exit. The output tail keeps
 * the last kilobyte, the same rule the install runner uses, so a failure names
 * the broken line.
 */
const downloadRunner = (command) => new Promise(resolve => {
    exec(command, { timeout: DOWNLOAD_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error === null) {
            resolve({ ok: true });
            return;
        }
        const detail = `${stderr ?? ''}${stdout ?? ''}`.trim().slice(-INSTALL_OUTPUT_TAIL);
        resolve({ ok: false, detail: detail === '' ? String(error) : detail });
    });
});
/**
 * hasSafetensorsIn reports whether one directory holds a `.safetensors`
 * weight file, the marker the Hyper-Qwen filter uses to tell a model repo
 * folder from a template or cache directory. An unreadable directory reads
 * as no weights.
 */
function hasSafetensorsIn(directory) {
    try {
        return readdirSync(directory).some((name) => name.endsWith('.safetensors'));
    }
    catch {
        return false;
    }
}
/**
 * probeGpu reads the GPU through nvidia-smi's CSV query. Any failure (no
 * nvidia-smi, no GPU, a hung daemon) degrades to null, which detection reads
 * as "no GPU" and the estimator reads as a zero usable budget.
 */
async function probeGpu() {
    const result = await runCommand('nvidia-smi', [
        '--query-gpu=name,memory.total,compute_cap',
        '--format=csv,noheader',
    ]);
    return result.ok ? parseNvidiaSmiGpu(result.stdout) : null;
}
/**
 * probeGpuUsage reads the card's live VRAM usage (used and total MiB)
 * through nvidia-smi's CSV query. Any failure (no nvidia-smi, no GPU, a hung
 * daemon) degrades to null, which the reserve resolver reads as "no usage
 * reading" and falls back to the 3 GiB default.
 */
async function probeGpuUsage() {
    const result = await runCommand('nvidia-smi', [
        '--query-gpu=memory.used,memory.total',
        '--format=csv,noheader',
    ]);
    return result.ok ? parseNvidiaSmiGpuUsage(result.stdout) : null;
}
/**
 * probeProcesses reads the running process table (`ps -eo pid,args`) into
 * process lines the launch-signature matcher consumes. The env element of a
 * line is read from the Linux /proc environ, and only for a pid whose command
 * line carries one of the engine markers: a full table of env reads is slow,
 * and the matcher's env-key element only fires on a marker-matched process
 * anyway. A host without /proc (macOS) degrades to env-less lines, which the
 * matcher reads as a neutral env element.
 */
async function probeProcesses(markers) {
    const result = await runCommand('ps', ['-eo', 'pid,args']);
    if (!result.ok)
        return [];
    const lines = [];
    for (const raw of result.stdout.split('\n')) {
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.startsWith('PID'))
            continue;
        const space = trimmed.indexOf(' ');
        if (space <= 0)
            continue;
        const pid = Number(trimmed.slice(0, space));
        const command = trimmed.slice(space + 1).trim();
        if (!Number.isFinite(pid) || command === '')
            continue;
        const env = markers.some(marker => command.includes(marker))
            ? readProcEnviron(pid)
            : undefined;
        lines.push({ pid, command, ...(env !== undefined ? { env } : {}) });
    }
    return lines;
}
/**
 * readProcEnviron reads one process's environment out of its /proc environ
 * file (NUL-separated KEY=VALUE entries). Any failure (no /proc, the process
 * exited, a permission) degrades to undefined, which the matcher reads as a
 * neutral env element rather than a no-match.
 */
function readProcEnviron(pid) {
    let raw;
    try {
        raw = readFileSync(`/proc/${pid}/environ`, 'utf8');
    }
    catch {
        return undefined;
    }
    const env = {};
    for (const entry of raw.split('\0')) {
        const eq = entry.indexOf('=');
        if (eq > 0) {
            env[entry.slice(0, eq)] = entry.slice(eq + 1);
        }
    }
    return Object.keys(env).length > 0 ? env : undefined;
}
/**
 * isProcessAlive reports whether a pid names a running process: a signal-0
 * send that throws ESRCH reads as dead, and EPERM (the process exists but the
 * signal is not permitted) reads as alive. The re-link rule prices the engine
 * pid and the record's parent pid through it.
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
/**
 * readProcessCommandLine reads one process's command line out of its /proc
 * cmdline file (NUL-separated argv). Any failure (no /proc on macOS, the
 * process exited, a permission) degrades to undefined, which the re-link rule
 * reads as a neutral command-line element rather than a mismatch.
 */
function readProcessCommandLine(pid) {
    let raw;
    try {
        raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    }
    catch {
        return undefined;
    }
    const args = raw.split('\0').filter((part) => part !== '');
    return args.length > 0 ? args.join(' ') : undefined;
}
/**
 * dshProcessIdentifies reports whether a process's command line carries the
 * dsh marker (the host runs from the @deepseek-ai/dsh package, so its argv
 * names it). The launch step runs it on the host's own pid before writing
 * the record's parent pid, so a host that is not DSH never claims an engine
 * it did not launch. A pid the host cannot read degrades to its own argv
 * when it is the host process, so a host without /proc still prices itself.
 */
function dshProcessIdentifies(pid) {
    const commandLine = readProcessCommandLine(pid);
    if (commandLine !== undefined) {
        return commandLine.toLowerCase().includes('dsh');
    }
    if (pid === process.pid) {
        return process.argv.join(' ').toLowerCase().includes('dsh');
    }
    return false;
}
/**
 * probeDocker checks for the docker binary. `docker --version` needs no
 * running daemon, so the flag means "docker is installed", not "the daemon
 * is up"; the deploy step is where a down daemon surfaces.
 */
async function probeDocker() {
    const result = await runCommand('docker', ['--version']);
    return result.ok;
}
/**
 * probePackageManager checks whether a package-manager binary exists on the
 * host. The probe is `which` on Linux and macOS and `where` on Windows (the
 * OS's own presence probe), so each answer is a plain presence flag the pure
 * detectPackageManager mapping turns into the winner.
 */
async function probePackageManager(binary, os) {
    const probe = os === 'windows' ? 'where' : 'which';
    const result = await runCommand(probe, [binary]);
    return result.ok;
}
/**
 * runHardwareProbes collects the raw probe results the detector consumes: the
 * OS, CPU thread count, host RAM, the GPU reading, docker availability,
 * WSL2, and the package-manager winner. The WSL2 read is a kernel-release
 * check (WSL2 kernels carry a "microsoft-standard-WSL2" suffix), which needs
 * no child process.
 */
export async function runHardwareProbes() {
    const osMap = {
        linux: 'linux',
        win32: 'windows',
        darwin: 'macos',
    };
    const os = osMap[platform()] ?? 'linux';
    const [gpu, dockerAvailable, apt, dnf, pacman, brew, winget] = await Promise.all([
        probeGpu(),
        probeDocker(),
        probePackageManager('apt-get', os),
        probePackageManager('dnf', os),
        probePackageManager('pacman', os),
        probePackageManager('brew', os),
        probePackageManager('winget', os),
    ]);
    return {
        os,
        cpuThreads: availableParallelism() || cpus().length,
        dockerAvailable,
        wsl2: os === 'linux' && release().toLowerCase().includes('wsl'),
        hostRamGiB: totalmem() / 2 ** 30,
        gpu,
        packageManager: detectPackageManager({ os, apt, dnf, pacman, brew, winget }) ?? null,
    };
}
export default LocalInfer;
//# sourceMappingURL=index.js.map