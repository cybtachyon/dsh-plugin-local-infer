/**
 * The request types the card's routes parse and the parsers that build them.
 * Every request carries only the keys the card sent: absent values fall back
 * to the stored config per key, the same rule every route applies. The
 * parsers read a `Record<string, unknown>` body (or a URL query) and build
 * the request with only the keys that are present, so
 * exactOptionalPropertyTypes never sees a `key: undefined` write.
 * @module dsh-plugin-local-infer/ui/request
 */
import { parseStoredPlatformConfig } from "./config.js";
/**
 * depsRequestFromUrl parses the engine and config query params the GET routes
 * (summary, deps) read. An absent engine falls back to the stored engine, and
 * a config that cannot be parsed falls back to the stored config, the same
 * rule the POST routes apply to a broken body key.
 */
export function depsRequestFromUrl(url) {
    const request = {};
    const engineParam = url.searchParams.get('engine');
    if (engineParam !== null) {
        request.engine = engineParam;
    }
    const configParam = url.searchParams.get('config');
    if (configParam !== null) {
        try {
            request.config = JSON.parse(configParam);
        }
        catch {
            // A config that cannot parse reads as absent, so the stored config wins.
        }
    }
    return request;
}
/**
 * launchRequestFromBody parses the launch and stop POST body: the engine,
 * config, and platform override the plan renders from, falling back to the
 * stored config per key. The stop route ignores the platform key.
 * `providerId` names the saved provider entry the launch record (or its
 * stop's clear) targets, and `autoRebuild` carries the card's Auto Rebuild
 * checkbox.
 */
export function launchRequestFromBody(body) {
    const request = {};
    if (typeof body.engine === 'string') {
        request.engine = body.engine;
    }
    if (body.config && typeof body.config === 'object') {
        request.config = body.config;
    }
    const platform = parseStoredPlatformConfig(body.platform);
    if (platform !== undefined) {
        request.platform = platform;
    }
    if (typeof body.providerId === 'string' && body.providerId.trim() !== '') {
        request.providerId = body.providerId;
    }
    if (typeof body.autoRebuild === 'boolean') {
        request.autoRebuild = body.autoRebuild;
    }
    return request;
}
/**
 * registerRequestFromBody parses the register and unregister POST body: the
 * engine and config the plan renders from, plus agentDefault for the register
 * route, falling back to the stored config per key.
 */
export function registerRequestFromBody(body) {
    const request = {};
    if (typeof body.engine === 'string') {
        request.engine = body.engine;
    }
    if (body.config && typeof body.config === 'object') {
        request.config = body.config;
    }
    if (typeof body.agentDefault === 'boolean') {
        request.agentDefault = body.agentDefault;
    }
    return request;
}
//# sourceMappingURL=request.js.map