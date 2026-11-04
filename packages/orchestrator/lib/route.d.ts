/**
 * The Orchestrator settings routes the Web card talks to: GET
 * /local-infer/orchestrator answers { prompt, defaultPrompt, saved } (the
 * effective prompt, the shipped prompt.md default, and whether the effective
 * prompt is a saved value), and POST /local-infer/orchestrator/save persists
 * { prompt } through the config setter (an empty string clears the saved
 * override back to the default) and answers with the same payload. The routes
 * are held by an effect, so they go when the component does.
 *
 * The HTTP plumbing is a minimal local mirror of the ui package's defineRoute
 * template (method guard 405, bounded body 413, JSON answer). The ui package
 * does export its template, but this package deliberately keeps no dependency
 * on ui: importing ui's route module would load its whole route graph (the
 * service, providers, and core packages) into a component that ships disabled
 * and must stay loadable headless, so the shared shape is copied rather than
 * imported, and the two copies change together by hand. The stream helpers
 * the ui template carries are dropped; these two routes only ever answer with
 * one JSON body.
 * @module dsh-plugin-local-infer/orchestrator/route
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * OrchestratorRoute is one webServer route definition the register step holds
 * by an effect: the stable name, the exact-match path, and the handler the web
 * server invokes per request.
 */
export interface OrchestratorRoute {
    name: string;
    kind: 'exact';
    path: string;
    handler: (req: IncomingLike, res: OutgoingLike) => void | Promise<void>;
}
/**
 * The webServer service is dsh-specific and absent from the cordis Context
 * type, so the route narrows the scoped context to the one member it needs
 * (same shape as the ui's WebServerService narrowing).
 */
export interface WebServerService {
    register(route: OrchestratorRoute): () => void;
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
 * registerOrchestratorRoutes registers the GET and save routes on the web
 * server and holds them by an effect, so a component switch off removes them
 * before the next switch on re-registers. The scoped context carries the
 * webServer.
 */
export declare function registerOrchestratorRoutes(scope: Context & {
    webServer: WebServerService;
}): void;
export {};
//# sourceMappingURL=route.d.ts.map
