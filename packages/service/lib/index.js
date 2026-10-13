/**
 * Service Definition for the local-inference capability seam (`ctx.localInfer`):
 * the engine, preset, guideline, and VramModel registries plus the
 * orchestration entry points that turn a config and a hardware profile into an
 * estimate, a set of warnings, a dependency plan, a launch, and a registered
 * DSH model.
 *
 * Providers register against the registries; the tool package and the UI call
 * the entry points. Registration is order-independent and a duplicate id is a
 * loud conflict, so hot-reload order never changes routing. `estimate` is
 * filled in by Phase 2 over the core estimator; the remaining entry points
 * fail loudly with `LOCAL_INFER_NOT_IMPLEMENTED` until later phases fill them
 * in.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { execFile } from 'node:child_process';
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os';
import { Service } from '@deepseek-ai/cordis';
import { detectHardware as detectHardwareFromProbes, estimateVram, parseNvidiaSmiGpu, } from '@dsh/dsh-plugin-local-infer/core';
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
    async guidelines(_config, _hw) {
        return this.notImplemented('guidelines');
    }
    async deps(_engine, _buildMode, _hw) {
        return this.notImplemented('deps');
    }
    async installString(_engine, _buildMode, _hw) {
        return this.notImplemented('installString');
    }
    async runInstall(_engine, _buildMode, _hw) {
        return this.notImplemented('runInstall');
    }
    async launch(_plan) {
        return this.notImplemented('launch');
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
 * runHardwareProbes collects the raw probe results the detector consumes: the
 * OS, CPU thread count, host RAM, the GPU reading, docker availability, and
 * WSL2. The WSL2 read is a kernel-release check (WSL2 kernels carry a
 * "microsoft-standard-WSL2" suffix), which needs no child process.
 */
export async function runHardwareProbes() {
    const osMap = {
        linux: 'linux',
        win32: 'windows',
        darwin: 'macos',
    };
    const os = osMap[platform()] ?? 'linux';
    const [gpu, dockerAvailable] = await Promise.all([probeGpu(), probeDocker()]);
    return {
        os,
        cpuThreads: availableParallelism() || cpus().length,
        dockerAvailable,
        wsl2: os === 'linux' && release().toLowerCase().includes('wsl'),
        hostRamGiB: totalmem() / 2 ** 30,
        gpu,
    };
}
export default LocalInfer;
//# sourceMappingURL=index.js.map