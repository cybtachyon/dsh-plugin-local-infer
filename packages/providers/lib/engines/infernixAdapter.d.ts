/**
 * The Infernix engine adapter. InfernixAdapter is the local-only engine for
 * Infernix, the C++/CUDA fork of NInfer (https://github.com/wallawalla47/infernix)
 * tuned for Qwen models on a single RTX 50-series GPU. `renderLaunch` renders a
 * local `infernix-serve` process from the `INFERNIX_PARAMETERS` surface (the
 * Infernix-only fields, from `--ngram-volume` to the quality routes, spell
 * onto the argv only for this engine); `deploy` builds the engine in the
 * engine directory (the engine's own cmake preset), downloads the model
 * artifact (and the n-gram volume, for the multi-file Flash-Next repo) into
 * the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process. The engine ships no docker image,
 * so the adapter supports the local build mode only.
 * @module dsh-plugin-local-infer/providers/engines/infernixAdapter
 */
import { EngineAdapter } from '../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../core/lib/index.js';
/**
 * InfernixAdapter is the local-only engine for Infernix, the C++/CUDA fork
 * of NInfer (https://github.com/wallawalla47/infernix) tuned for Qwen models
 * on a single RTX 50-series GPU. `renderLaunch` renders a local
 * `infernix-serve` process from the `INFERNIX_PARAMETERS` surface (the
 * Infernix-only fields, from `--ngram-volume` to the quality routes, spell
 * onto the argv only for this engine); `deploy` builds the engine in the
 * engine directory (the engine's own cmake preset), downloads the model
 * artifact (and the n-gram volume, for the multi-file Flash-Next repo) into
 * the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process. The engine ships no docker image,
 * so the adapter supports the local build mode only.
 */
export declare class InfernixAdapter extends EngineAdapter {
    readonly id = "infernix";
    readonly supports: {
        docker: boolean;
        local: boolean;
    };
    private readonly host;
    private readonly children;
    constructor(host?: LifecycleHost);
    parameters(): readonly ParameterSpec[];
    modelRef(config: Config): {
        id: string;
        name: string;
    };
    launchSignature(config?: Config): EngineLaunchSignature;
    renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan;
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig, onProgress?: LaunchProgress, options?: DeployOptions): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private port;
    private planKey;
    private downloadModel;
}
//# sourceMappingURL=infernixAdapter.d.ts.map