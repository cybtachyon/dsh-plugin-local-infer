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
import { defaultOrchestratorPrompt, getOrchestratorPrompt, hasSavedOrchestratorPrompt, setOrchestratorPrompt, } from './config.js';
/**
 * RouteError is a route failure that carries its own HTTP status, so a
 * handler can answer a validation rejection with its own code instead of the
 * spec's failStatus.
 */
class RouteError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = 'RouteError';
        this.status = status;
    }
}
/**
 * The request body size cap the save route enforces: a prompt is a few
 * kilobytes at most, so a body past 64 KiB is a client bug, not a prompt.
 * Deliberately mirrors the cap in packages/ui/src/route.ts (ui is not a
 * dependency here): one malformed client misbehaves the same on every
 * /local-infer route, so edit the two together.
 */
const MAX_BODY_BYTES = 64 * 1024;
/**
 * readJsonBody collects a bounded JSON request body: chunks up to the cap,
 * then parses. A body past the cap destroys the request and throws a 413
 * RouteError carrying the route's own message, so the answer names the route
 * that rejected the body.
 */
async function readJsonBody(req, tooLargeMessage) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
            req.destroy();
            throw new RouteError(413, tooLargeMessage);
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Writes one JSON answer (status head plus body) on the response. */
function writeJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}
/**
 * defineRoute is the local template both route specs build on: it guards the
 * method (405), reads the bounded body (413, POST only), and maps the
 * handler's answer to a status: a RouteError carries its own status, any
 * other failure answers with the spec's failStatus.
 */
function defineRoute(spec) {
    return {
        name: spec.name,
        kind: 'exact',
        path: spec.path,
        handler: async (req, res) => {
            if (req.method !== spec.method) {
                res.writeHead(405).end();
                return;
            }
            try {
                const body = spec.method === 'POST' ? await readJsonBody(req, spec.tooLargeMessage) : {};
                await spec.run({ url: new URL(req.url, 'http://localhost'), body }, (status, answer) => writeJson(res, status, answer));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    writeJson(res, error.status, { error: error.message });
                    return;
                }
                writeJson(res, spec.failStatus, { error: String(error?.message ?? error) });
            }
        },
    };
}
function orchestratorPayload() {
    return {
        prompt: getOrchestratorPrompt(),
        defaultPrompt: defaultOrchestratorPrompt(),
        saved: hasSavedOrchestratorPrompt(),
    };
}
/**
 * orchestratorGetRoute builds the GET /local-infer/orchestrator route. The
 * client treats any non-404 answer as proof the route is mounted, so the
 * payload answers 200 even before anything is saved.
 */
function orchestratorGetRoute() {
    return defineRoute({
        name: 'local-infer-orchestrator',
        path: '/local-infer/orchestrator',
        method: 'GET',
        failStatus: 500,
        run: async (_input, json) => {
            json(200, orchestratorPayload());
        },
    });
}
/**
 * orchestratorSaveRoute builds the POST /local-infer/orchestrator/save route:
 * a string prompt persists through setOrchestratorPrompt (an empty string
 * clears the saved override back to the default) and the answer carries the
 * GET payload shape so the card re-renders from one response.
 */
function orchestratorSaveRoute() {
    return defineRoute({
        name: 'local-infer-orchestrator-save',
        path: '/local-infer/orchestrator/save',
        method: 'POST',
        failStatus: 400,
        tooLargeMessage: 'orchestrator prompt payload too large',
        run: async ({ body }, json) => {
            if (typeof body.prompt !== 'string') {
                throw new RouteError(400, 'prompt must be a string');
            }
            setOrchestratorPrompt(body.prompt);
            json(200, orchestratorPayload());
        },
    });
}
/**
 * registerOrchestratorRoutes registers the GET and save routes on the web
 * server and holds them by an effect, so a component switch off removes them
 * before the next switch on re-registers. The scoped context carries the
 * webServer.
 */
export function registerOrchestratorRoutes(scope) {
    const routes = [orchestratorGetRoute(), orchestratorSaveRoute()];
    scope.effect(() => {
        const disposers = routes.map((route) => scope.webServer.register(route));
        return () => {
            for (const dispose of disposers) {
                dispose();
            }
        };
    }, 'local-infer-orchestrator: settings routes');
}
//# sourceMappingURL=route.js.map
