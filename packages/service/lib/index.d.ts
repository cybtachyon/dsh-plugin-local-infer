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
 * filled in by Phase 2 over the core estimator and `guidelines` by Phase 3
 * over the core guideline engine; the remaining entry points fail loudly with
 * `LOCAL_INFER_NOT_IMPLEMENTED` until later phases fill them in.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Config, EngineAdapter, Guideline, GuidelineResult, HardwareProfile, HardwareProbes, InstallResult, LaunchPlan, Preset, RegisterResult, SystemDep, VramModel } from '@dsh/dsh-plugin-local-infer/core';
import type { EstimateResult, LaunchResult, LocalInferService } from './types.ts';
export type { EstimateResult, LaunchResult, LocalInferService } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        localInfer: LocalInferService;
    }
}
/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_INVALID_MODEL`, `LOCAL_INFER_NOT_IMPLEMENTED`) that callers
 * route on instead of parsing the message.
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
    constructor(ctx: Context);
    registerEngine(adapter: EngineAdapter): () => void;
    registerPreset(preset: Preset): () => void;
    registerGuideline(guideline: Guideline): () => void;
    registerVramModel(model: VramModel): () => void;
    registeredEngines(): readonly EngineAdapter[];
    registeredPresets(): readonly Preset[];
    registeredGuidelines(): readonly Guideline[];
    registeredVramModels(): readonly VramModel[];
    estimate(config: Config, hw: HardwareProfile): Promise<EstimateResult>;
    /**
     * detectHardware runs the host probes (nvidia-smi, docker, WSL2, OS, CPU,
     * RAM) and turns their results into the HardwareProfile every relationship
     * consumes. A probe that fails or times out degrades to "not available"
     * for that capability, so detection never throws on a bare host.
     */
    detectHardware(): Promise<HardwareProfile>;
    /**
     * guidelines runs the full guideline engine over a config and a hardware
     * profile: the registered named guidelines, every per-spec hardware
     * constraint of the registered engines, and the model-aware rules that
     * price against the resolved VramModel (the estimator-backed "exceeds
     * usable VRAM" and "spec needs draft weights" rules). The result list is
     * the single source the UI banner and the inline red warnings render from.
     */
    guidelines(config: Config, hw: HardwareProfile): Promise<GuidelineResult[]>;
    deps(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<SystemDep[]>;
    installString(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<string>;
    runInstall(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<InstallResult>;
    launch(_plan: LaunchPlan): Promise<LaunchResult>;
    registerModel(_plan: LaunchPlan): Promise<RegisterResult>;
    /**
     * Picks the VramModel an estimate prices against: the one the config names
     * by `model`, or the single registered model when the config names none.
     * Zero or several candidates with no name leave the estimate not-measured
     * rather than a guess.
     */
    private resolveVramModel;
    /**
     * collectSpecs gathers the parameter surfaces of every registered engine,
     * deduped by key in registration order. A key two engines share (spec,
     * draftTokens, vision) keeps the first engine's spec, so a config warning
     * reads from one surface, not a collision.
     */
    private collectSpecs;
    /**
     * The scaffold's placeholder for an entry point a later phase fills in. It
     * fails loudly so a caller never mistakes "not built yet" for a real answer.
     */
    private notImplemented;
}
/**
 * runHardwareProbes collects the raw probe results the detector consumes: the
 * OS, CPU thread count, host RAM, the GPU reading, docker availability, and
 * WSL2. The WSL2 read is a kernel-release check (WSL2 kernels carry a
 * "microsoft-standard-WSL2" suffix), which needs no child process.
 */
export declare function runHardwareProbes(): Promise<HardwareProbes>;
export default LocalInfer;
//# sourceMappingURL=index.d.ts.map