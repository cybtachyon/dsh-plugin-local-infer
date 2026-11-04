/**
 * The Basalt engine adapter. BasaltAdapter is the Basalt engine (the C++/CUDA
 * serve/ server for the Qwen3.8-Flash-Next MoE model, Blackwell-only).
 * `renderLaunch` renders a `basalt serve --config` process plan: the binary
 * name comes from the host OS profile, and every setting lands in the
 * `basalt_config.json` the plan's `configFile` carries (rendered from the
 * spec surface with `configFileFromSpecs`), so the launch argv stays three
 * tokens long no matter how many settings the form offers. `deploy` builds
 * the engine in the checkout (the acquisition build steps), downloads the
 * `.basalt` model into the model directory, writes the config file, and
 * spawns the serve command. `healthCheck` polls the health URL and reports
 * the start phase from the tracked process output. `stop` signals the
 * tracked process.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltAdapter
 */
import { EngineAdapter } from '../../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../../core/lib/index.js';
/**
 * The Hugging Face repo and file the deploy step downloads into the model
 * directory: the single `.basalt` artifact the engine serves (the weights,
 * tokenizer, chat template, drafter, vision projector, and default
 * sampling all come from it).
 */
export declare const BASALT_MODEL_REPO = "jesdga/Qwen3.8-Flash-Next-Basalt";
export declare const BASALT_MODEL_FILE = "Qwen3.8-FN-NVFP4-DQ6_K.basalt";
/**
 * The config file name the deploy step writes into the model directory, so
 * the engine's `--config` flag and the model artifact share one home.
 */
export declare const BASALT_CONFIG_FILE = "basalt_config.json";
/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config` process plan (the settings ride the config file,
 * never the argv); `deploy` builds the engine, downloads the model, writes
 * the config file, and spawns the serve command; `healthCheck` polls the
 * health URL and reports the start phase from the tracked process output;
 * `stop` signals the tracked process.
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
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private port;
    private planKey;
}
//# sourceMappingURL=basaltAdapter.d.ts.map
