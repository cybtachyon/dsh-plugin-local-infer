/**
 * The Strata engine adapter. StrataAdapter is the Strata engine, three build
 * modes. `renderLaunch` renders a `docker run` of the ghcr image (docker
 * mode), a `strata launch` process (binary mode), or a `setup.sh` run with the
 * model (local mode); `deploy` pulls the image, installs the Terminal, or
 * git-syncs the checkout and resolves `setup.sh` to an absolute path in it
 * before spawning (spawn resolves a bare name against PATH, not the cwd);
 * `healthCheck` polls the health URL; `stop` stops the named container, runs
 * `strata launch --stop`, or signals the tracked process. The model the
 * engine serves is the config model (or the engine's own pick when none is
 * named), and the engine downloads it itself, so the deploy step runs no model
 * download of its own. When the config names no model, `discoverModel`
 * queries the running engine's model endpoint through the terminal for the id
 * it actually loaded (family and size sized to the host), so the registrar
 * publishes the served model, not a placeholder.
 * @module dsh-plugin-local-infer/providers/engines/strataAdapter
 */
import { EngineAdapter } from '../../../core/lib/index.js';
import type { Config, DeployOptions, DeployResult, EngineLaunchSignature, EngineLaunchState, EnginePlatformConfig, HealthCheckOptions, HealthResult, HardwareProfile, LaunchPlan, LaunchProgress, LifecycleHost, ParameterSpec } from '../../../core/lib/index.js';
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
 * strataPreReadyState reads the phase the strata process is in from the tail of
 * its accumulated output. The Terminal downloads the engine and the model files
 * before it can serve, and prints a progress line for each (Downloading,
 * Unpacking, Checking the package signature, Getting the model files, ...), so
 * a tail that carries one of those reads as downloading. A tail past the
 * download (the engine starting, the API binding) reads as starting. The tail
 * is the most recent output, so a finished download no longer reads as
 * downloading even though its progress lines are still in the buffer.
 */
export declare function strataPreReadyState(logs: string): Exclude<EngineLaunchState, 'ready' | 'failed'>;
/**
 * strataServedModelId reads the served model id out of a /v1/models answer:
 * the id of the first entry in the JSON `data` list. The engine names the
 * model it auto-selected with family and size (qwen3.8-flash-next-iq3_s), so
 * the registrar can publish the id the engine actually serves. A body that is
 * not JSON, or carries no usable id (an error page, a truncated answer), reads
 * as no discovery.
 */
export declare function strataServedModelId(body: string): string | undefined;
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
 * the deploy step runs no model download of its own. When the config names no
 * model, `discoverModel` queries the running engine's model endpoint through
 * the terminal for the id it actually loaded (family and size sized to the
 * host), so the registrar publishes the served model, not a placeholder.
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
    discoverModel(config: Config): Promise<{
        id: string;
        name: string;
    } | undefined>;
    modelInput(config: Config): string[];
    launchSignature(config?: Config): EngineLaunchSignature;
    renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan;
    deploy(plan: LaunchPlan, platform?: EnginePlatformConfig, onProgress?: LaunchProgress, options?: DeployOptions): Promise<DeployResult>;
    healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
    stop(plan: LaunchPlan): Promise<void>;
    private buildMode;
    private port;
    private planKey;
}
//# sourceMappingURL=strataAdapter.d.ts.map