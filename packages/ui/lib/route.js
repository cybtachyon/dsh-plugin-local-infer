/**
 * The webServer routes the Web card talks to. GET /local-infer/summary
 * returns the engine list, the detected hardware, the form model for the
 * selected engine, the VRAM meter model for the current config, the default
 * model list and the model status (presence, hf CLI, download command) the
 * banner and inline red warnings render from; POST /local-infer/save persists
 * the config; POST /local-infer/download runs the hf CLI download for a
 * default model; POST /local-infer/launch and /local-infer/stop drive the
 * engine lifecycle; and POST /local-infer/register and /local-infer/
 * unregister publish the engine as a DSH model through the settings seam.
 * The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The routes are held by an effect, so they
 * go when the plugin does.
 *
 * This module holds the HTTP plumbing every route builds on: the RouteError
 * the domain operations throw with their own status, the RouteResponder the
 * handlers answer through, and defineRoute, the template method that guards
 * the method (405), reads the bounded body (413), and maps the handler's
 * answer to a status. The request parsing lives in ./request.ts, the stored-
 * config persistence in ./config.ts, the view models in ./viewmodels/, the
 * operations in ./ops/, and each route definition in its own file under
 * ./routes/. registerLocalInferRoute wires them onto the web server.
 * @module dsh-plugin-local-infer/ui/route
 */
import { readConfig } from "./config.js";
import { handleEngineDeath, relinkStoredProviders, syncPlatformConfigs, } from "./ops/engine.js";
import { chatTemplateRoute } from "./routes/chat-template.js";
import { depsRoute } from "./routes/deps.js";
import { downloadRoute } from "./routes/download.js";
import { getRoute } from "./routes/get.js";
import { installRoute } from "./routes/install.js";
import { launchRoute } from "./routes/launch.js";
import { providerDeleteRoute } from "./routes/provider-delete.js";
import { registerRoute } from "./routes/register.js";
import { saveRoute } from "./routes/save.js";
import { stopRoute } from "./routes/stop.js";
import { summaryRoute } from "./routes/summary.js";
import { unregisterRoute } from "./routes/unregister.js";
/**
 * RouteError is a route failure that carries its own HTTP status, so the
 * handlers map the domain answer (a gate that is off, an unsupported build
 * mode) to a status the card can read instead of a blanket 500.
 */
export class RouteError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = 'RouteError';
        this.status = status;
    }
}
/**
 * The request body size cap the POST routes enforce: a config payload is a
 * few kilobytes at most, so a body past 64 KiB is a client bug, not a config.
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
/**
 * RouteResponder is the answer side of a route: the JSON writer every route
 * answers through, the stream openers the Get and launch routes use for live
 * output, and the chunk writer a fake response may omit (the route then
 * degrades to collecting only).
 */
export class RouteResponder {
    res;
    constructor(res) {
        this.res = res;
    }
    /** Write a JSON answer: the status and content-type head, then the body. */
    json(status, body) {
        this.res.writeHead(status, { 'content-type': 'application/json' });
        this.res.end(JSON.stringify(body));
    }
    /** Open a plain-text stream (the Get route's live log output). */
    textStream() {
        this.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    }
    /** Open an NDJSON stream (the launch route's progress events). */
    ndjsonStream() {
        this.res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    }
    /** Stream one chunk; a fake response without write() collects nothing. */
    write(chunk) {
        if (typeof this.res.write === 'function') {
            this.res.write(chunk);
        }
    }
    /** End the response, optionally with a final body chunk. */
    end(body) {
        this.res.end(body);
    }
}
/**
 * defineRoute is the template every route file builds on: it guards the
 * method (405), reads the bounded body (413, POST only), and maps the
 * handler's answer to a status: a RouteError carries its own status, any
 * other failure answers with the spec's failStatus. The route files carry
 * only the handler body.
 */
export function defineRoute(spec) {
    return {
        name: spec.name,
        kind: 'exact',
        path: spec.path,
        handler: async (req, res) => {
            if (req.method !== spec.method) {
                res.writeHead(405).end();
                return;
            }
            const responder = new RouteResponder(res);
            try {
                const body = spec.method === 'POST' ? await readJsonBody(req, spec.tooLargeMessage) : {};
                await spec.run({ url: new URL(req.url, 'http://localhost'), body }, responder);
            }
            catch (error) {
                if (error instanceof RouteError) {
                    responder.json(error.status, { error: error.message });
                    return;
                }
                responder.json(spec.failStatus, { error: String(error?.message ?? error) });
            }
        },
    };
}
/**
 * registerLocalInferRoute registers the summary, save, provider-delete, deps,
 * install, download, chat-template, get, launch, stop, register, and
 * unregister routes on the web server and holds them by an effect, so a
 * bundle switch off removes them before the next switch on re-registers. The
 * scoped context carries the webServer; the localInfer service is passed in
 * because the scope only injects what it names. The optional getHost is the
 * lifecycle host the Get route's git and build steps run through; it
 * defaults to the node host, and a test injects a stub so the route never
 * clones a real repo in CI.
 */
export function registerLocalInferRoute(scope, localInfer, getHost) {
    const routes = [
        summaryRoute(localInfer),
        saveRoute(localInfer),
        providerDeleteRoute(localInfer),
        depsRoute(localInfer),
        installRoute(localInfer),
        downloadRoute(localInfer),
        chatTemplateRoute(localInfer),
        getRoute(localInfer, getHost),
        launchRoute(localInfer),
        stopRoute(localInfer),
        registerRoute(localInfer),
        unregisterRoute(localInfer),
    ];
    scope.effect(() => {
        // Sync the service's platform-config registry with the stored config on
        // route registration, so a launch before the first save reads the
        // platform config the user last saved.
        syncPlatformConfigs(localInfer, readConfig());
        // The engine death observer: a crash, a pkill, or the poll-detected exit
        // of an adopted process clears the provider entry's launch record and
        // notes the exit in the last-run logs the moment it happens, so the card
        // and a later restart read the provider stopped rather than stale.
        localInfer.setEngineDeathObserver(handleEngineDeath);
        // The mount re-link: re-adopt a surviving engine from a stored launch
        // record and start its liveness watcher without waiting for the card to
        // open the summary route, so a DSH that restarts re-attaches its engines
        // and a pkill after the restart still settles the stored state.
        void relinkStoredProviders(localInfer, readConfig()).catch(() => undefined);
        const disposers = routes.map((route) => scope.webServer.register(route));
        return () => {
            localInfer.setEngineDeathObserver(undefined);
            for (const dispose of disposers) {
                dispose();
            }
        };
    }, 'local-infer: settings routes');
}
//# sourceMappingURL=route.js.map