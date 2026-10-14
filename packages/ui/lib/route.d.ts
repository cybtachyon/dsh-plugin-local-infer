/**
 * The webServer routes the Web card talks to. GET /local-infer/summary
 * returns the engine list, the detected hardware, the form model for the
 * selected engine, the VRAM meter model for the current config, and the
 * guideline warning model the banner and inline red warnings render from;
 * POST /local-infer/save persists the config; POST /local-infer/launch and
 * /local-infer/stop drive the engine lifecycle; and POST /local-infer/
 * register and /local-infer/unregister publish the engine as a DSH model
 * through the settings seam. The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The routes are held by an effect, so they
 * go when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config, DefaultProvenance, HardwareProfile, InstallResult, RegisterResult, VramModel, VramVerdict } from '@dsh/dsh-plugin-local-infer/core';
import type { LaunchResult, LocalInferService } from '@dsh/dsh-plugin-local-infer/service';
import type { EngineInfo } from '../../providers/lib/index.js';
import type { DepsModel } from './deps.ts';
import type { FormModel } from './form.ts';
import type { MeterModel } from './meter.ts';
import type { WarningsModel } from './warnings.ts';
/**
 * The webServer service is dsh-specific and absent from the cordis Context
 * type, so the route narrows the scoped context to the two members it needs.
 */
export interface WebServerService {
    register(route: {
        name: string;
        kind: 'exact';
        path: string;
        handler: (req: IncomingLike, res: OutgoingLike) => void | Promise<void>;
    }): () => void;
}
interface IncomingLike extends AsyncIterable<Buffer> {
    method: string;
    url: string;
    destroy(): void;
}
interface OutgoingLike {
    writeHead(status: number, headers?: Record<string, string>): OutgoingLike;
    end(body?: string): void;
}
/**
 * LocalInferSummary is the JSON the card renders: the engine list, the model
 * list, the detected hardware, the form model for the selected engine, the
 * meter model for the current config, the verdict the banner renders, the
 * guideline warning model the red banner and inline warnings render from,
 * and the config the form edits. Every field is plain data, so it crosses
 * the socket without a function left behind.
 */
export interface LocalInferSummary {
    engines: {
        id: string;
        label: string;
        supports: {
            docker: boolean;
            local: boolean;
        };
    }[];
    models: {
        id: string;
        source: string;
    }[];
    hardware: HardwareProfile;
    engineId: string;
    formModel: FormModel;
    meterModel: MeterModel;
    verdict: VramVerdict;
    warningsModel: WarningsModel;
    config: Config;
    platformConfigs: Record<string, StoredPlatformConfig>;
    defaults: DefaultsModel;
}
/**
 * DefaultsModel is the resolved-defaults read model the card draws: the
 * starting config the defaults resolver produced and the per-key provenance
 * that names the source that supplied each value (a preset, the user, or a
 * spec default).
 */
export interface DefaultsModel {
    config: Config;
    provenance: DefaultProvenance[];
}
/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export declare function localInferConfigPath(): string;
/**
 * StoredPlatformConfig is the per-engine platform config the deploy step
 * consumes (§3.10): where the engine platform lives locally and the git repo
 * that overrides the engine's default upstream. The map is keyed by engine id,
 * so the stored entry carries no id of its own; the route adds it when it
 * builds the EnginePlatformConfig the service registry stores.
 */
export interface StoredPlatformConfig {
    engineDirectory?: string;
    engineFork?: string;
}
export interface StoredConfig {
    engine: string;
    config: Config;
    allowRunDeps: boolean;
    platform: Record<string, StoredPlatformConfig>;
}
/**
 * readConfig reads the stored engine, config, trust gate, and per-engine
 * platform configs. A missing or broken file reads as the scaffold default
 * (NInfer, empty config, gate off, no platform configs) so the card always has
 * a form to draw. A platform entry that is not an object (or whose fields are
 * not strings) is dropped, so a by-hand edit never poisons the deploy step.
 */
export declare function readConfig(): StoredConfig;
/**
 * writeConfig persists the engine, config, trust gate, and per-engine platform
 * configs, creating the directory tree on first write.
 */
export declare function writeConfig(engine: string, config: Config, allowRunDeps: boolean, platform?: Record<string, StoredPlatformConfig>): void;
/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, the meter model the
 * service's estimate prices, and the warning model the service's guideline
 * engine fires. The estimate is the single source the meter and the verdict
 * banner agree on, and the guideline results are the single source the red
 * banner and the inline warnings agree on.
 */
export declare function buildSummary(localInfer: LocalInferService, request?: {
    engine?: string;
    config?: Config;
}): Promise<LocalInferSummary>;
/**
 * RouteError is a route failure that carries its own HTTP status, so the
 * handlers map the domain answer (a gate that is off, an unsupported build
 * mode) to a status the card can read instead of a blanket 500.
 */
export declare class RouteError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
/**
 * DepsRequest is the query the card sends for the deps panel: the engine and
 * the config the build mode reads from. Absent values fall back to the stored
 * config, the same rule the summary route applies.
 */
export interface DepsRequest {
    engine?: string;
    config?: Config;
}
/**
 * resolveBuildMode picks the deploy mode the dep plan prices: the config's
 * buildMode when the selected engine supports it, else the engine's default
 * (local when the engine can build locally, docker when it cannot). The
 * docker-not-installed guideline reads this same value, so the panel and the
 * warning never disagree about the mode.
 */
export declare function resolveBuildMode(engine: EngineInfo, config: Config): 'docker' | 'local';
/**
 * buildDeps assembles the deps panel read model for one engine and config:
 * the detected hardware (with its package manager), the dep plan the service
 * resolves, the per-dep statuses, the copy/paste install string, and the
 * Play/Run trust gate the stored config carries.
 */
export declare function buildDeps(localInfer: LocalInferService, request?: DepsRequest): Promise<DepsModel>;
/**
 * InstallResponse is the answer to a Play/Run: the install result and the
 * refreshed deps model, so the card re-renders the gate from the same
 * re-check the install ran.
 */
export interface InstallResponse {
    result: InstallResult;
    deps: DepsModel;
}
/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 */
export declare function runInstallFor(localInfer: LocalInferService, request: DepsRequest): Promise<InstallResponse>;
/**
 * LaunchRequest is the query the card sends for the launch and stop routes: the
 * engine and the config the plan renders from. `platform` carries the card's
 * unsaved Engine Directory / Engine Fork edits for the engine, so a launch uses
 * them without a prior save. Absent values fall back to the stored config, the
 * same rule the summary route applies.
 */
export interface LaunchRequest {
    engine?: string;
    config?: Config;
    platform?: StoredPlatformConfig;
}
/**
 * launchEngine renders the plan the registered adapter produces for the config
 * and the detected hardware, then runs the service's launch entry point
 * (deploy, then the health poll). The detail the launch returns names the
 * broken step when the engine does not come up.
 */
export declare function launchEngine(localInfer: LocalInferService, request: LaunchRequest): Promise<LaunchResult>;
/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started.
 */
export declare function stopEngine(localInfer: LocalInferService, request: LaunchRequest): Promise<void>;
/**
 * RegisterRequest is the query the card sends for the register and
 * unregister routes: the engine and the config the plan renders from, and
 * agentDefault, which points the agent default model at the registered
 * engine. Absent values fall back to the stored config, the same rule the
 * summary route applies.
 */
export interface RegisterRequest {
    engine?: string;
    config?: Config;
    agentDefault?: boolean;
}
/**
 * resolveContextWindow picks the context window the registrar publishes: the
 * config's maxContext when it names one, else the native ceiling of the
 * VramModel the config resolves to (the named model, or the single
 * registered model), else the 32768 spec default. The DSH contextWindow must
 * not promise a context the engine cannot serve, so the ceiling is the
 * model's own, not an optimistic number.
 */
export declare function resolveContextWindow(config: Config, models: readonly VramModel[]): number;
/**
 * registerFor renders the plan through the registered adapter, resolves the
 * model row and the context window, and runs the service's register entry
 * point, which upserts the provider and model through the settings seam.
 * The result carries the entry the registrar wrote, so the card names the
 * model it published.
 */
export declare function registerFor(localInfer: LocalInferService, request?: RegisterRequest): Promise<RegisterResult>;
/**
 * unregisterFor runs the service's removeModel entry point for the engine's
 * provider and the model row the register step resolved, so the removal
 * targets the exact entry the registration wrote.
 */
export declare function unregisterFor(localInfer: LocalInferService, request?: RegisterRequest): Promise<{
    removed: boolean;
}>;
/**
 * registerLocalInferRoute registers the summary, save, deps, install, launch,
 * stop, register, and unregister routes on the web server and holds them by
 * an effect, so a bundle switch off removes them before the next switch on
 * re-registers. The scoped context carries the webServer; the localInfer
 * service is passed in because the scope only injects what it names.
 */
export declare function registerLocalInferRoute(scope: Context & {
    webServer: WebServerService;
}, localInfer: LocalInferService): void;
export {};
//# sourceMappingURL=route.d.ts.map