import type { Config, EngineAdapter, Guideline, GuidelineResult, HardwareProfile, InstallResult, LaunchPlan, Preset, RegisterResult, SystemDep, VramBreakdown, VramModel, VramVerdict } from '@dsh/dsh-plugin-local-infer/core';
/**
 * EstimateResult is the answer to an estimate call: the full VRAM breakdown,
 * the one-word verdict the meter renders, and the source the numbers came
 * from, so the meter labels measured versus estimated.
 */
export interface EstimateResult {
    breakdown: VramBreakdown;
    verdict: VramVerdict;
    source: 'measured' | 'estimated' | 'not-measured';
}
/**
 * LaunchResult is the answer to a launch call: the plan that was started,
 * whether the health check passed, and a detail for the UI.
 */
export interface LaunchResult {
    plan: LaunchPlan;
    healthy: boolean;
    detail?: string;
}
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
    estimate(config: Config, hw: HardwareProfile): Promise<EstimateResult>;
    detectHardware(): Promise<HardwareProfile>;
    guidelines(config: Config, hw: HardwareProfile): Promise<GuidelineResult[]>;
    deps(engine: EngineAdapter, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<SystemDep[]>;
    installString(engine: EngineAdapter, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<string>;
    runInstall(engine: EngineAdapter, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<InstallResult>;
    launch(plan: LaunchPlan): Promise<LaunchResult>;
    registerModel(plan: LaunchPlan): Promise<RegisterResult>;
}
//# sourceMappingURL=types.d.ts.map