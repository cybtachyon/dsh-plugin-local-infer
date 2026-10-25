/**
 * The llama.cpp engine adapter. LlamaCppAdapter is the llama.cpp engine,
 * both-capable like NInfer. `renderLaunch` renders a local `llama-server`
 * process or a `docker run` of the ggml image from the same
 * `LLAMACPP_PARAMETERS` surface; `deploy` builds the engine in the engine
 * directory (or pulls the image), downloads the GGUF model into the model
 * directory, and starts the engine; `healthCheck` polls the health URL;
 * `stop` signals the tracked process and stops the named container.
 * @module dsh-plugin-local-infer/providers/engines/llamacppAdapter
 */
import { EngineAdapter } from '../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../core/lib/index.js';
/**
 * The llama.cpp docker image the adapter pulls and runs. The engineFork
 * platform config overrides the git source for a local build; the image stays
 * the upstream ggml artifact.
 */
export declare const LLAMACPP_DOCKER_IMAGE = "ghcr.io/ggml-org/llama.cpp";
/**
 * LlamaCppAdapter is the llama.cpp engine, both-capable like NInfer.
 * `renderLaunch` renders a local `llama-server` process or a `docker run` of the
 * ggml image from the same `LLAMACPP_PARAMETERS` surface; `deploy` builds the
 * engine in the engine directory (or pulls the image), downloads the GGUF model
 * into the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process and stops the named container.
 */
export declare class LlamaCppAdapter extends EngineAdapter {
    readonly id = "llamacpp";
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
    private buildMode;
    private port;
    private planKey;
    private downloadModel;
}
//# sourceMappingURL=llamacppAdapter.d.ts.map