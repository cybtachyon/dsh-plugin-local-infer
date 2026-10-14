/**
 * The webServer route the Web card talks to. GET /local-infer/summary returns
 * the engine list, the detected hardware, the form model for the selected
 * engine, the VRAM meter model for the current config, and the guideline
 * warning model the banner and inline red warnings render from; POST
 * /local-infer/save persists the config. The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The route is held by an effect, so it goes
 * when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config, HardwareProfile, InstallResult, VramVerdict } from '@dsh/dsh-plugin-local-infer/core';
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service';
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
}
/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export declare function localInferConfigPath(): string;
export interface StoredConfig {
    engine: string;
    config: Config;
    allowRunDeps: boolean;
}
/**
 * readConfig reads the stored engine, config, and the allowRunDeps trust gate.
 * A missing or broken file reads as the scaffold default (NInfer, empty
 * config, gate off) so the card always has a form to draw.
 */
export declare function readConfig(): StoredConfig;
/**
 * writeConfig persists the engine, config, and trust gate, creating the
 * directory tree on first write.
 */
export declare function writeConfig(engine: string, config: Config, allowRunDeps: boolean): void;
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
 * registerLocalInferRoute registers the summary, save, deps, and install
 * routes on the web server and holds them by an effect, so a bundle switch
 * off removes them before the next switch on re-registers. The scoped context
 * carries the webServer; the localInfer service is passed in because the
 * scope only injects what it names.
 */
export declare function registerLocalInferRoute(scope: Context & {
    webServer: WebServerService;
}, localInfer: LocalInferService): void;
export {};
//# sourceMappingURL=route.d.ts.map