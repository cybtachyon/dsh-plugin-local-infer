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
 * Phase 4 over the core provisioner, and `launch` and `stop` by Phase 5 over
 * the registered engine adapters. The remaining entry points fail loudly
 * with `LOCAL_INFER_NOT_IMPLEMENTED` until later phases fill them in.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { execFile, spawn } from 'node:child_process';
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { Service } from '@deepseek-ai/cordis';
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { detectHardware as detectHardwareFromProbes, detectPackageManager, evaluateGuidelines, estimateVram, modelGuidelines, parseNvidiaSmiGpu, renderInstallString, runInstall, } from '../../core/lib/index.js';
/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_INVALID_MODEL`, `LOCAL_INFER_NOT_IMPLEMENTED`) that callers
 * route on instead of parsing the message.
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
    async estimate(config, hw) {
        const model = this.resolveVramModel(config);
        const estimate = estimateVram(model, config, hw);
        return { breakdown: estimate.breakdown, verdict: estimate.verdict, source: estimate.source };
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
     * guidelines runs the full guideline engine over a config and a hardware
     * profile: the registered named guidelines, every per-spec hardware
     * constraint of the registered engines, and the model-aware rules that
     * price against the resolved VramModel (the estimator-backed "exceeds
     * usable VRAM" and "spec needs draft weights" rules). The result list is
     * the single source the UI banner and the inline red warnings render from.
     */
    async guidelines(config, hw) {
        const results = evaluateGuidelines(this.registeredGuidelines(), this.collectSpecs(), config, hw);
        const model = this.resolveVramModel(config);
        if (model !== undefined) {
            for (const result of modelGuidelines(model, config, hw)) {
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
        return this.depPlanRegistry.get(engineId)?.[buildMode] ?? [];
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
        const deployResult = await adapter.deploy(plan, platform);
        if (!deployResult.ok) {
            // exactOptionalPropertyTypes: only write the detail key when it is present.
            const result = { plan, healthy: false };
            if (deployResult.detail !== undefined) {
                result.detail = deployResult.detail;
            }
            return result;
        }
        const health = await adapter.healthCheck(plan, options);
        const launchResult = { plan, healthy: health.healthy };
        if (health.detail !== undefined) {
            launchResult.detail = health.detail;
        }
        return launchResult;
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
        await adapter.stop(plan);
    }
    async registerModel(_plan) {
        return this.notImplemented('registerModel');
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
    /**
     * The scaffold's placeholder for an entry point a later phase fills in. It
     * fails loudly so a caller never mistakes "not built yet" for a real answer.
     */
    async notImplemented(entryPoint) {
        throw new LocalInferError(`localInfer.${entryPoint} is not implemented in the scaffold`, 'LOCAL_INFER_NOT_IMPLEMENTED');
    }
}
/**
 * The stable registry key for a preset: its exact (engine, model, hardware
 * class) triple. A preset is only trusted for the triple it was sourced for,
 * so the key never collapses two distinct presets.
 */
function presetKey(preset) {
    return `${preset.engineId}/${preset.modelId}/${preset.hardwareClass}`;
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
    child.on('close', code => {
        if (code === 0) {
            resolve({ ok: true });
            return;
        }
        resolve({ ok: false, detail: `exit ${code}: ${output.trim().slice(-INSTALL_OUTPUT_TAIL)}` });
    });
});
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
 * probeDocker checks for the docker binary. `docker --version` needs no
 * running daemon, so the flag means "docker is installed", not "the daemon
 * is up"; the deploy step is where a down daemon surfaces.
 */
async function probeDocker() {
    const result = await runCommand('docker', ['--version']);
    return result.ok;
}
/**
 * probePackageManager checks which of the four package-manager binaries exist
 * on the host. `which` is a read-only probe, so each answer is a plain
 * presence flag the pure detectPackageManager mapping turns into the winner.
 */
async function probePackageManager(binary) {
    const result = await runCommand('which', [binary]);
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
    const [gpu, dockerAvailable, apt, dnf, pacman, brew] = await Promise.all([
        probeGpu(),
        probeDocker(),
        probePackageManager('apt-get'),
        probePackageManager('dnf'),
        probePackageManager('pacman'),
        probePackageManager('brew'),
    ]);
    return {
        os,
        cpuThreads: availableParallelism() || cpus().length,
        dockerAvailable,
        wsl2: os === 'linux' && release().toLowerCase().includes('wsl'),
        hostRamGiB: totalmem() / 2 ** 30,
        gpu,
        packageManager: detectPackageManager({ os, apt, dnf, pacman, brew }) ?? null,
    };
}
export default LocalInfer;
//# sourceMappingURL=index.js.map