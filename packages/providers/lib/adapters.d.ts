/**
 * The concrete engine adapters: NInfer (docker and local) and Hyper-Qwen
 * (compose). Each composes the provider `ParameterSpec` data into a
 * `LaunchPlan` and drives its deploy, health-check, and stop steps through an
 * injectable `LifecycleHost`, so the tests stub the host and never run a real
 * build, docker, or network in CI. The node implementation
 * (`nodeLifecycleHost`) is what the service wires in on a live host.
 * @module dsh-plugin-local-infer/providers/adapters
 */
import { EngineAdapter } from '../../core/lib/index.js';
import type { Config, DebugLogger, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../core/lib/index.js';
export { INFERNIX_MODEL_ARTIFACTS } from './infernix.ts';
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
 * customArgFlags turns the card's Custom Arguments rows (`config.customArgs`)
 * into the flat flag list the adapters append to the launch argv. Each row is
 * a key (a flag, e.g. `--kv-dtype`) and an optional value: a row with a value
 * contributes `[key, value]`, a bare row contributes `[key]`. A row with a
 * blank key contributes nothing, and a non-array `customArgs` (an older config
 * that predates the key) reads as no custom args, so an engine that never had
 * the section launches unchanged.
 */
export declare function customArgFlags(config: Config): string[];
/**
 * customArgEnv turns the card's Custom Arguments rows (`config.customArgs`)
 * into the environment map the compose adapter appends to the plan's env: each
 * row's key becomes an env var set to its value. A row with no value is skipped,
 * because an empty env var is not a meaningful override. A non-array
 * `customArgs` (an older config that predates the key) reads as no custom args.
 */
export declare function customArgEnv(config: Config): Record<string, string>;
/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export declare function envFromSpecs(specs: readonly ParameterSpec[], config: Config): Record<string, string>;
/**
 * createNodeLifecycleHost builds the node `LifecycleHost`: `run` through the
 * system shell (a 10-minute cap, so a hung CUDA build cannot hang the panel),
 * `spawn` a detached child the stop step can signal, and `fetch` the health
 * URL. A fetch that throws (no route, connection refused) reads as status 0,
 * which the poll treats as not-ready. When `debug` is provided, the host logs
 * every command it issues (each `run` line and each `spawn` argv) through it,
 * so a DSH debug-mode host captures the full build-to-launch sequence.
 */
export declare function createNodeLifecycleHost(debug?: DebugLogger): LifecycleHost;
/**
 * nodeLifecycleHost is the default live host the service wires in: the node
 * implementation with no debug logger, so a normal (non-debug) run logs no
 * commands. The providers' apply step swaps in a debug-aware host when DSH is
 * in debug mode.
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
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig, onProgress?: LaunchProgress, _options?: DeployOptions): Promise<DeployResult>;
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
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig, onProgress?: LaunchProgress, options?: DeployOptions): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private buildMode;
    private port;
    private planKey;
    private downloadModel;
}
/**
 * The Strata docker image the adapter pulls and runs. The image is the
 * upstream GitHub Container Registry artifact for the newest release's CUDA 13
 * flavor (NVIDIA RTX 20/30/40/50 series, driver 580 or newer); the README pins
 * a version tag when updates should only land on purpose.
 */
export declare const STRATA_DOCKER_IMAGE = "ghcr.io/niko1221/strata:latest-cuda13";
/**
 * The one-line install the Strata binary build mode runs: it downloads the
 * `strata` Terminal from the latest release, checks its SHA-256, unpacks it into
 * the user's home folder, and puts `strata` on the PATH. Sourced from
 * docs/AI_SETUP.md step 2 (Linux and Mac; Windows uses the PowerShell twin).
 */
export declare const STRATA_BINARY_INSTALL = "curl -fsSL https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o install.sh && sh install.sh";
/**
 * StrataAdapter is the Strata engine, three build modes. `renderLaunch` renders
 * a `docker run` of the ghcr image (docker mode), a `strata launch` process
 * (binary mode), or a `setup.sh` run with the model (local mode); `deploy` pulls
 * the image, installs the Terminal, or git-syncs the checkout and resolves
 * `setup.sh` to an absolute path in it before spawning (spawn resolves a bare
 * name against PATH, not the cwd); `healthCheck` polls the health URL; `stop`
 * stops the named container, runs `strata launch --stop`, or signals the
 * tracked process. The model the engine serves is the config model (or the
 * engine's own pick when none is named), and the engine downloads it itself, so
 * the deploy step runs no model download of its own.
 */
export declare class StrataAdapter extends EngineAdapter {
    readonly id = "strata";
    readonly supports: {
        docker: boolean;
        local: boolean;
        binary: boolean;
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
}
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
//# sourceMappingURL=adapters.d.ts.map