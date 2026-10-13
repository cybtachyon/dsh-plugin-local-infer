/**
 * The webServer route the Web card talks to. GET /local-infer/summary returns
 * the engine list, the detected hardware, the form model for the selected
 * engine, and the VRAM meter model for the current config; POST /local-infer/
 * save persists the config. The values live in ~/.dsh/local-infer/config.json,
 * shared with the CLI, so the browser never sees a secret it did not store.
 * The route is held by an effect, so it goes when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config, HardwareProfile, VramVerdict } from '@dsh/dsh-plugin-local-infer/core';
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service';
import type { FormModel } from './form.ts';
import type { MeterModel } from './meter.ts';
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
 * meter model for the current config, the verdict the banner renders, and the
 * config the form edits. Every field is plain data, so it crosses the socket
 * without a function left behind.
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
}
/**
 * readConfig reads the stored engine and config. A missing or broken file reads
 * as the scaffold default (NInfer, empty config) so the card always has a form
 * to draw.
 */
export declare function readConfig(): StoredConfig;
/**
 * writeConfig persists the engine and config, creating the directory tree on
 * first write.
 */
export declare function writeConfig(engine: string, config: Config): void;
/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, and the meter model the
 * service's estimate prices. The estimate is the single source the meter and
 * the banner agree on.
 */
export declare function buildSummary(localInfer: LocalInferService, request?: {
    engine?: string;
    config?: Config;
}): Promise<LocalInferSummary>;
/**
 * registerLocalInferRoute registers the summary and save routes on the web
 * server and holds them by an effect, so a bundle switch off removes them
 * before the next switch on re-registers. The scoped context carries the
 * webServer; the localInfer service is passed in because the scope only
 * injects what it names.
 */
export declare function registerLocalInferRoute(scope: Context & {
    webServer: WebServerService;
}, localInfer: LocalInferService): void;
export {};
//# sourceMappingURL=route.d.ts.map