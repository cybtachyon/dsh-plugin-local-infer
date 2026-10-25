/**
 * The NInfer engine adapter. NInferModelArtifact is the per-model deploy data:
 * the `.ninfer` artifact file, the Hugging Face repo the model download pulls
 * it from, and the `--model-id` alias the server advertises. The data is the
 * surface; adding a model is a data edit here, never an adapter rewire.
 * NInferAdapter is the canonical both-capable engine. `renderLaunch` renders a
 * local `ninfer-serve` process or a `docker run` of the ghcr image from the
 * same spec surface; `deploy` builds the engine in the engine directory (or
 * pulls the image), downloads the model into the model directory, and starts
 * the engine; `healthCheck` polls the health URL; `stop` signals the tracked
 * process and stops the named container.
 * @module dsh-plugin-local-infer/providers/engines/ninferAdapter
 */
import { EngineAdapter } from '../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../core/lib/index.js';
/**
 * NInferModelArtifact is the per-model deploy data: the `.ninfer` artifact
 * file, the Hugging Face repo the model download pulls it from, and the
 * `--model-id` alias the server advertises. The data is the surface; adding a
 * model is a data edit here, never an adapter rewire.
 */
export interface NInferModelArtifact {
    file: string;
    repo: string;
    modelId: string;
}
/**
 * The NInfer model artifacts, keyed by the model registry id. The 27B entry
 * is the default the DEFAULT_MODELS list names; the 35B-A3B entries are the
 * Qwen3.8 measured artifact (`qwen3-35b`) and the Qwen3.6 default
 * (`qwen36-35b`).
 */
export declare const NINFER_MODEL_ARTIFACTS: Record<string, NInferModelArtifact>;
/**
 * The NInfer docker image the adapter pulls and runs. The engineFork platform
 * config overrides the git source for a local build; the image stays the
 * upstream ghcr artifact.
 */
export declare const NINFER_DOCKER_IMAGE = "ghcr.io/iamwavecut/ninfer-all";
/**
 * NInferAdapter is the canonical both-capable engine. `renderLaunch` renders a
 * local `ninfer-serve` process or a `docker run` of the ghcr image from the
 * same spec surface; `deploy` builds the engine in the engine directory (or
 * pulls the image), downloads the model into the model directory, and starts
 * the engine; `healthCheck` polls the health URL; `stop` signals the tracked
 * process and stops the named container.
 */
export declare class NInferAdapter extends EngineAdapter {
    readonly id = "ninfer";
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
    /**
     * resolveChatTemplate rewrites a --chat-template flag that carries an HF repo
     * reference into the local file the engine reads. A value with a slash that
     * is not an absolute path (the combo control's known choices) is a repo the
     * deploy step downloads into the model directory; an already-local path is
     * left as-is. The download is best-effort: a template that is already on
     * disk is used without a re-fetch, and a missing hf CLI leaves the flag
     * untouched so the engine reports the missing template itself.
     */
    private resolveChatTemplate;
}
//# sourceMappingURL=ninferAdapter.d.ts.map