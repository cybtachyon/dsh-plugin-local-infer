/**
 * The card's API layer: typed fetch wrappers for the /local-infer/* routes
 * plus the stream readers the launch and get routes drive.
 *
 * Every wrapper is a thin typed round trip over the global fetch: the GET
 * routes (summary, deps) price the card's draft, and the POST routes
 * (save, install, register, unregister, launch, stop, get, download,
 * chat-template, provider-delete) mutate the host. A JSON answer that is
 * not OK throws with the route's error field, so the caller's catch reads
 * the host's own message. The launch route streams NDJSON (a step event as
 * each phase begins, then a final result event), and the get route streams
 * plain text, so the two readers live here too. readNdjsonLines buffers
 * chunks into whole lines: a line split across chunks completes on the
 * next chunk, a partial final line (a stream that ends without a trailing
 * newline) is still parsed, and a line that is not JSON is skipped, so one
 * broken line never breaks the stream.
 * @module dsh-plugin-local-infer/client/api/routes
 */
/**
 * readNdjsonLines reads an NDJSON stream and hands each parsed line to
 * onEvent. It buffers chunks into whole lines: a line split across chunk
 * boundaries completes on the next chunk, a partial final line (a stream
 * that ends without a trailing newline) is still parsed, and a line that
 * does not parse as JSON is skipped, so one broken line never breaks the
 * stream.
 */
export async function readNdjsonLines(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handleLine = (line) => {
        if (line === '') {
            return;
        }
        try {
            onEvent(JSON.parse(line));
        }
        catch {
            // A line that is not JSON is not an event; skip it.
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            handleLine(line);
        }
    }
    // The stream ended: a final line without a trailing newline is still an
    // event (the route's result event), so flush it.
    handleLine(buffer);
}
/**
 * readLaunchStream reads the launch route's NDJSON answer and returns the
 * final result event, handing each step event to onStep. A non-OK response
 * throws with the body text. A response with no streamable body (a host
 * that cannot stream) reads the whole body as the result JSON. A stream
 * that ends without a result event returns null, so the caller settles its
 * control to failed.
 */
export async function readLaunchStream(response, onStep) {
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'HTTP ' + response.status);
    }
    if (response.body === null || typeof response.body.getReader !== 'function') {
        return (await response.json());
    }
    let result = null;
    await readNdjsonLines(response.body, (event) => {
        if (event.step !== undefined) {
            onStep?.(event.step);
        }
        else if (event.result !== undefined) {
            result = event.result;
        }
    });
    return result;
}
/**
 * readTextStream reads the get route's plain-text answer and hands each
 * decoded chunk to onChunk. A non-OK response throws with the body text. A
 * response with no streamable body reads the whole body at once.
 */
export async function readTextStream(response, onChunk) {
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'HTTP ' + response.status);
    }
    if (response.body === null || typeof response.body.getReader !== 'function') {
        onChunk(await response.text());
        return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        onChunk(decoder.decode(value, { stream: true }));
    }
}
// withQuery builds the query string a GET route takes: the engine and the
// JSON-encoded config, each absent when undefined.
function withQuery(path, query) {
    const params = new URLSearchParams();
    if (query?.engine) {
        params.set('engine', query.engine);
    }
    if (query?.config) {
        params.set('config', JSON.stringify(query.config));
    }
    const suffix = params.toString();
    return suffix ? path + '?' + suffix : path;
}
// getJson reads a GET route's typed JSON answer. A non-OK response throws
// with the route's error field.
async function getJson(path, query) {
    const response = await fetch(withQuery(path, query));
    const json = (await response.json());
    if (!response.ok) {
        throw new Error(json.error ?? 'HTTP ' + response.status);
    }
    return json;
}
// post sends a JSON POST body to a /local-infer route and returns the raw
// response, so the stream readers can take it from there.
async function post(path, body) {
    return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}
// postJson sends a JSON POST body and parses the typed JSON answer. A
// non-OK response throws with the route's error field.
async function postJson(path, body) {
    const response = await post(path, body);
    const json = (await response.json());
    if (!response.ok) {
        throw new Error(json.error ?? 'HTTP ' + response.status);
    }
    return json;
}
/**
 * routeExists probes whether the host route is mounted: any response other
 * than a 404 (and other than a network failure) proves the route exists.
 * The bootstrap uses it to decide whether to mount the card, so a headless
 * profile (no web route) keeps the card off the Plugins page.
 */
export async function routeExists() {
    try {
        const response = await fetch('/local-infer/summary');
        return response.status !== 404;
    }
    catch {
        // A network failure (the host is unreachable) reads as absent.
        return false;
    }
}
/** fetchSummary reads the card's read model (the GET /local-infer/summary route). */
export function fetchSummary(query) {
    return getJson('/local-infer/summary', query);
}
/** fetchDeps reads the deps panel model (the GET /local-infer/deps route). */
export function fetchDeps(query) {
    return getJson('/local-infer/deps', query);
}
/** postSave upserts a provider entry and persists the global fields. */
export function postSave(request) {
    return postJson('/local-infer/save', request);
}
/** postInstall runs the Play/Run path and answers with the re-checked deps. */
export function postInstall(request) {
    return postJson('/local-infer/install', request);
}
/** postRegister publishes the engine as a DSH model. */
export function postRegister(request) {
    return postJson('/local-infer/register', request);
}
/** postUnregister removes the DSH model row the register step wrote. */
export function postUnregister(request) {
    return postJson('/local-infer/unregister', request);
}
/**
 * postLaunch runs the deploy and the health poll through the launch route's
 * NDJSON stream, handing each step event to onStep and returning the final
 * result event (null when the stream ended without one).
 */
export async function postLaunch(request, onStep) {
    const response = await post('/local-infer/launch', request);
    return readLaunchStream(response, onStep);
}
/** postStop signals the tracked process or container. */
export function postStop(request) {
    return postJson('/local-infer/stop', request);
}
/**
 * postGet runs the git sync, the dependency plan, and the build through the
 * get route's text stream, handing each chunk to onChunk as it lands.
 */
export async function postGet(request, onChunk) {
    const response = await post('/local-infer/get', request);
    await readTextStream(response, onChunk);
}
/** postDownload pulls the selected model into the model directory. */
export function postDownload(request) {
    return postJson('/local-infer/download', request);
}
/** postChatTemplate pulls the selected chat template into the model directory. */
export function postChatTemplate(request) {
    return postJson('/local-infer/chat-template', request);
}
/** postProviderDelete removes a saved provider entry and answers with the fresh summary. */
export function postProviderDelete(request) {
    return postJson('/local-infer/provider-delete', request);
}
//# sourceMappingURL=routes.js.map
