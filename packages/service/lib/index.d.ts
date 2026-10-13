/**
 * Service Definition for the local-inference capability seam (`ctx.localInfer`):
 * the engine, preset, and guideline registries plus the orchestration entry
 * points that turn a config and a hardware profile into an estimate, a set of
 * warnings, a dependency plan, a launch, and a registered DSH model.
 *
 * Providers register against the registries; the tool package and the UI call
 * the entry points. Registration is order-independent and a duplicate id is a
 * loud conflict, so hot-reload order never changes routing. The orchestration
 * entry points are declared here and filled in by later phases; in the
 * scaffold they fail loudly with `LOCAL_INFER_NOT_IMPLEMENTED` rather than
 * returning a silent default.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Config, EngineAdapter, Guideline, GuidelineResult, HardwareProfile, InstallResult, LaunchPlan, Preset, RegisterResult, SystemDep } from '@dsh/dsh-plugin-local-infer/core';
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
 * `LOCAL_INFER_NOT_IMPLEMENTED`) that callers route on instead of parsing the
 * message.
 */
export declare class LocalInferError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * `ctx.localInfer`. Holds the engine, preset, and guideline reservations; the
 * registries are read per call so a provider that unloads mid-session stops
 * serving without leaving a stale route behind.
 */
export declare class LocalInfer extends Service implements LocalInferService {
    private readonly engineRegistry;
    private readonly presetRegistry;
    private readonly guidelineRegistry;
    constructor(ctx: Context);
    registerEngine(adapter: EngineAdapter): () => void;
    registerPreset(preset: Preset): () => void;
    registerGuideline(guideline: Guideline): () => void;
    registeredEngines(): readonly EngineAdapter[];
    registeredPresets(): readonly Preset[];
    registeredGuidelines(): readonly Guideline[];
    estimate(_config: Config, _hw: HardwareProfile): Promise<EstimateResult>;
    guidelines(_config: Config, _hw: HardwareProfile): Promise<GuidelineResult[]>;
    deps(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<SystemDep[]>;
    installString(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<string>;
    runInstall(_engine: EngineAdapter, _buildMode: 'docker' | 'local', _hw: HardwareProfile): Promise<InstallResult>;
    launch(_plan: LaunchPlan): Promise<LaunchResult>;
    registerModel(_plan: LaunchPlan): Promise<RegisterResult>;
    /**
     * The scaffold's placeholder for an entry point a later phase fills in. It
     * fails loudly so a caller never mistakes "not built yet" for a real answer.
     */
    private notImplemented;
}
export default LocalInfer;
//# sourceMappingURL=index.d.ts.map