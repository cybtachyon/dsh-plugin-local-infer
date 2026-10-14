/**
 * The concrete engine adapters: NInfer (docker and local) and Hyper-Qwen
 * (compose). Each composes the provider `ParameterSpec` data into a
 * `LaunchPlan` and drives its deploy, health-check, and stop steps through an
 * injectable `LifecycleHost`, so the tests stub the host and never run a real
 * build, docker, or network in CI. The node implementation
 * (`nodeLifecycleHost`) is what the service wires in on a live host.
 * @module @dsh/dsh-plugin-local-infer/providers/adapters
 */
import { EngineAdapter } from '../../core/lib/index.js';
import type { Config, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LifecycleHost, ParameterSpec } from '../../core/lib/index.js';
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
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing.
 */
export declare function flagsFromSpecs(specs: readonly ParameterSpec[], config: Config): string[];
/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export declare function envFromSpecs(specs: readonly ParameterSpec[], config: Config): Record<string, string>;
/**
 * The node `LifecycleHost`: `run` through the system shell (a 10-minute cap, so
 * a hung CUDA build cannot hang the panel), `spawn` a detached child the stop
 * step can signal, and `fetch` the health URL. A fetch that throws (no route,
 * connection refused) reads as status 0, which the poll treats as not-ready.
 */
export declare const nodeLifecycleHost: LifecycleHost;
/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep.
 */
export declare function pollHealth(host: LifecycleHost, plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
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
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private buildMode;
    private port;
    private planKey;
    private downloadModel;
}
/**
 * HyperQwenAdapter is the docker-compose engine. `renderLaunch` renders a
 * compose plan (the compose file, the profile, and the `.env` the spec surface
 * maps to); `deploy` runs `docker compose up`; `healthCheck` polls the health
 * URL; `stop` runs `docker compose down`.
 */
export declare class HyperQwenAdapter extends EngineAdapter {
    readonly id = "hyperqwen";
    readonly supports: {
        docker: boolean;
        local: boolean;
    };
    private readonly host;
    constructor(host?: LifecycleHost);
    parameters(): readonly ParameterSpec[];
    modelRef(_config: Config): {
        id: string;
        name: string;
    };
    launchSignature(config?: Config): EngineLaunchSignature;
    renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan;
    deploy(plan: LaunchPlan): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private port;
    private profile;
}
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
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private buildMode;
    private port;
    private planKey;
    private downloadModel;
}
/**
 * The Strata docker image the adapter pulls and runs. Strata is the
 * placeholder engine: the image and the parameter data land when the engine
 * is available, and the adapter renders a bare docker plan until then.
 */
export declare const STRATA_DOCKER_IMAGE = "ghcr.io/strata/strata";
/**
 * StrataAdapter is the placeholder docker-only engine. `renderLaunch` renders
 * a `docker run` of the Strata image (no spec surface yet, so no flags);
 * `deploy` pulls the image and starts the container; `healthCheck` polls the
 * health URL; `stop` stops the named container. The parameter surface and the
 * per-model data land with the engine, as data edits, never an adapter rewire.
 */
export declare class StrataAdapter extends EngineAdapter {
    readonly id = "strata";
    readonly supports: {
        docker: boolean;
        local: boolean;
    };
    private readonly host;
    private readonly children;
    constructor(host?: LifecycleHost);
    parameters(): readonly ParameterSpec[];
    modelRef(_config: Config): {
        id: string;
        name: string;
    };
    launchSignature(config?: Config): EngineLaunchSignature;
    renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan;
    deploy(plan: LaunchPlan): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private port;
    private planKey;
}
//# sourceMappingURL=adapters.d.ts.map