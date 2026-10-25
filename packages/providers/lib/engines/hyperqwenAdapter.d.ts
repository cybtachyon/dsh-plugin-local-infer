/**
 * The Hyper-Qwen engine adapter. HyperQwenAdapter is the docker-compose
 * engine. `renderLaunch` renders a compose plan (the compose file, the
 * profile, and the `.env` the spec surface maps to); `deploy` runs
 * `docker compose up`; `healthCheck` polls the health URL; `stop` runs
 * `docker compose down`.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenAdapter
 */
import { EngineAdapter } from '../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../core/lib/index.js';
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
//# sourceMappingURL=hyperqwenAdapter.d.ts.map