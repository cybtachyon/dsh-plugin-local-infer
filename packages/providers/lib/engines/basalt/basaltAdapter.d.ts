/**
 * The Basalt engine adapter. BasaltAdapter is the Basalt engine (the
 * C++/CUDA serve/ server for the Qwen3.8-Flash-Next and DeepSeek-V4.1-Flash
 * MoE models, Blackwell-only).
 * `renderLaunch` renders a `basalt serve --config --engine-bin` process
 * plan: the binary name comes from the host OS profile, every setting and
 * the served model land in the `basalt_config.json` the plan's `configFile`
 * carries (the spec surface rendered with `configFileFromSpecs` into the
 * versioned v2 envelope the 0.3.0 serve CLI accepts), and the argv carries
 * the CLI-only `--engine-bin` flag, so it stays fixed no matter how many
 * settings the form offers. `deploy` builds the engine in the checkout (the
 * acquisition build steps), downloads the `.basalt` model into the model
 * directory, stamps the artifact path into the config entry, writes the
 * config file, and spawns the serve command.
 * `healthCheck` polls the health URL and reports the start phase from the
 * tracked process output. `stop` signals the tracked process.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltAdapter
 */
import { EngineAdapter } from '../../../../core/lib/index.js';
import type { CommandLogger, Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../../core/lib/index.js';
export { BASALT_MODEL_FILE, BASALT_MODEL_REPO } from './basalt.ts';
/**
 * The config file name the deploy step writes. It lands in the plugin's
 * config cache home in the per-engine subdirectory (Basalt takes the path
 * via `--config`, so it carries no placement requirement of its own), never
 * the model directory, the hub cache, or the engine checkout.
 */
export declare const BASALT_CONFIG_FILE = "basalt_config.json";
/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config --engine-bin` process plan (the settings and the
 * served model ride the versioned config file; the argv carries the CLI-only
 * `--engine-bin` flag); `deploy` builds the engine, downloads the model,
 * stamps the artifact path into the config entry, writes the config file,
 * and spawns the serve command; `healthCheck` polls the health URL and
 * reports the start phase from the tracked process output; `stop` signals
 * the tracked process.
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
     * ensureModelArtifact downloads the `.basalt` model file named by the
     * resolved download source (its repo URL plus artifact file) into the
     * model directory and resolves the concrete path the engine serves. A
     * model the Get-steps routine already downloaded is on disk, so the
     * re-fetch is skipped; presence is the deterministic snapshot check
     * (modelArtifactPresent), so a blob-only cache left by an interrupted
     * download re-runs the cheap hf download (the CLI reuses the blobs and
     * writes the snapshot links) instead of dead-ending on the later lookup.
     * With the hub-cache layout the concrete path is the content-addressed
     * snapshot path (only known after the download); with the flat layout it
     * is the flat join. Returns the path, or a detail when the download fails
     * or leaves no snapshot.
     */
    private ensureModelArtifact;
    /**
     * writeConfigFile writes the config file the plan names, so the engine's
     * --config flag points at a path that exists. renderLaunch renders the
     * path absolute under the plugin's config cache home, and the host's
     * writeFile mkdirs the parent before writing. Returns a failure detail (a
     * host that cannot write files, a test stub) or null when the write
     * succeeded or the plan names no config file.
     */
    private writeConfigFile;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan, log?: CommandLogger): Promise<void>;
    private port;
}
//# sourceMappingURL=basaltAdapter.d.ts.map
