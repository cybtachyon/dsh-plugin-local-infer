import type { Config } from './config.ts';
import type { HardwareProfile } from './hardware.ts';
import type { ParameterSpec } from './parameter.ts';
import type { SystemDep } from './deps.ts';
/**
 * LaunchPlan is the engine-neutral result of rendering a config: how to start
 * the engine (a local process, a docker container, or a compose file), the
 * port it serves on, and the URL to poll for health.
 */
export interface LaunchPlan {
    kind: 'process' | 'docker' | 'compose';
    argv?: string[];
    env?: Record<string, string>;
    composeFile?: string;
    port: number;
    healthUrl: string;
}
/**
 * HealthResult is the answer to a /health poll: whether the engine is up, the
 * HTTP status, and a detail string for the UI.
 */
export interface HealthResult {
    healthy: boolean;
    status?: number;
    detail?: string;
}
/**
 * DeployResult reports whether a build-or-pull succeeded, with a detail for the
 * UI.
 */
export interface DeployResult {
    ok: boolean;
    detail?: string;
}
/**
 * EngineAdapter is the abstract base one subclass implements per engine. It
 * owns the engine's parameter surface and turns a config into a launch plan,
 * deploys it, health-checks it, and stops it. NInfer is the canonical adapter
 * that supports both docker and local; the others follow the same shape.
 */
export declare abstract class EngineAdapter {
    abstract readonly id: string;
    abstract readonly supports: {
        docker: boolean;
        local: boolean;
    };
    abstract parameters(): ParameterSpec[];
    abstract renderLaunch(config: Config, hw: HardwareProfile): LaunchPlan;
    abstract healthCheck(plan: LaunchPlan): Promise<HealthResult>;
    abstract deploy(plan: LaunchPlan): Promise<DeployResult>;
    abstract stop(plan: LaunchPlan): Promise<void>;
    /**
     * Optional: the host deps this engine's deploy step needs for a build mode,
     * declared by the adapter that knows its own toolchain. The service asks a
     * registered adapter first and falls back to the provider-registered plan
     * for the engine id when the adapter declares none.
     */
    systemDeps?(buildMode: 'docker' | 'local', hw: HardwareProfile): readonly SystemDep[];
}
//# sourceMappingURL=adapter.d.ts.map