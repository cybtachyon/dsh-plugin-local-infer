/**
 * The Basalt engine adapter. BasaltAdapter is the Basalt engine (the C++/CUDA
 * serve/ server for the Qwen3.8-Flash-Next MoE model, Blackwell-only).
 * `renderLaunch` renders a `basalt serve --config --model --engine-bin`
 * process plan: the binary name comes from the host OS profile, every
 * setting lands in the `basalt_config.json` the plan's `configFile` carries
 * (rendered from the spec surface with `configFileFromSpecs`), and the argv
 * carries the `--model` and `--engine-bin` flags the serve CLI requires, so
 * it stays fixed no matter how many settings the form offers. `deploy` builds
 * the engine in the checkout (the acquisition build steps), downloads the
 * `.basalt` model into the model directory, writes the config file, and
 * spawns the serve command. `healthCheck` polls the health URL and reports
 * the start phase from the tracked process output. `stop` signals the
 * tracked process.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltAdapter
 */
import { EngineAdapter } from '../../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../../core/lib/index.js';
export { BASALT_MODEL_FILE, BASALT_MODEL_REPO } from './basalt.ts';
/**
 * The config file name the deploy step writes into the model directory, so
 * the engine's `--config` flag and the model artifact share one home.
 */
export declare const BASALT_CONFIG_FILE = "basalt_config.json";
/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config --model --engine-bin` process plan (the settings
 * ride the config file; the argv carries the `--model` and `--engine-bin`
 * flags the serve CLI requires); `deploy` builds the engine, downloads the
 * model, writes the config file, and spawns the serve command;
 * `healthCheck` polls the health URL and reports the start phase from the
 * tracked process output; `stop` signals the tracked process.
 */
export declare class BasaltAdapter extends EngineAdapter {
    readonly id = "basalt";
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
    modelInput(config: Config): string[];
    launchSignature(config?: Config): EngineLaunchSignature;
    renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan;
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig, onProgress?: LaunchProgress, options?: DeployOptions): Promise<DeployResult>;
    /**
     * ensureModelArtifact downloads the .basalt model file into the model
     * directory and resolves the concrete path the engine serves. A model the
     * Get-steps routine already downloaded is on disk, so the re-fetch is
     * skipped. With the hub-cache layout the concrete path is the
     * content-addressed snapshot path (only known after the download); with the
     * flat layout it is the flat join. Returns the path, or a detail when the
     * download fails or leaves no snapshot.
     */
    private ensureModelArtifact;
    /**
     * withModelArgv swaps the --model flag's value token for the concrete
     * artifact path. It builds a new array, so the plan (shared with the launch
     * record) keeps its placeholder. A plan with no --model flag (a pre-flag
     * plan) stands as-is.
     */
    private withModelArgv;
    /**
     * writeConfigFile writes the config file the plan names, so the engine's
     * --config flag points at a path that exists. The config path is always
     * absolute (renderLaunch joins the model download target base directory),
     * so the file lands in the model download target directory, never the
     * engine's git checkout. Returns a failure detail (a host that cannot write
     * files, a test stub) or null when the write succeeded or the plan names no
     * config file.
     */
    private writeConfigFile;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private port;
}
//# sourceMappingURL=basaltAdapter.d.ts.map
