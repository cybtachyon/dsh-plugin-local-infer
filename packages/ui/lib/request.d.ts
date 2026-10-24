/**
 * The request types the card's routes parse and the parsers that build them.
 * Every request carries only the keys the card sent: absent values fall back
 * to the stored config per key, the same rule every route applies. The
 * parsers read a `Record<string, unknown>` body (or a URL query) and build
 * the request with only the keys that are present, so
 * exactOptionalPropertyTypes never sees a `key: undefined` write.
 * @module dsh-plugin-local-infer/ui/request
 */
import type { Config } from 'dsh-plugin-local-infer/core';
import type { StoredPlatformConfig } from './config.ts';
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
 * DownloadRequest is the query the card sends for the download route: the
 * engine, model, and directory the hf CLI download targets. Absent values
 * fall back to the stored config, the same rule the summary route applies.
 */
export interface DownloadRequest {
    engine?: string;
    model?: string;
    directory?: string;
}
/**
 * ChatTemplateDownloadRequest is the query the card sends for the chat-template
 * download route: the engine, the template repo reference, and the directory
 * the hf CLI targets. Absent values fall back to the stored config, the same
 * rule the summary route applies.
 */
export interface ChatTemplateDownloadRequest {
    engine?: string;
    template?: string;
    directory?: string;
}
/**
 * LaunchRequest is the query the card sends for the launch and stop routes: the
 * engine and the config the plan renders from. `platform` carries the card's
 * unsaved Engine Directory / Engine Fork edits for the engine, so a launch uses
 * them without a prior save. `providerId` names the saved provider entry the
 * launch drives, so the route persists the launch record (or clears it on a
 * stop) on that entry. `autoRebuild` is the card's "Auto Rebuild" checkbox:
 * when false, the deploy step skips the git sync (fetch, rebase, rebuild) and
 * launches the checkout as-is. Absent values fall back to the stored config,
 * the same rule the summary route applies.
 */
export interface LaunchRequest {
    engine?: string;
    config?: Config;
    platform?: StoredPlatformConfig;
    providerId?: string;
    autoRebuild?: boolean;
}
/**
 * GetRequest is the query the card sends for the Get route: the engine and
 * the config the dep plan and the build mode read from, and the platform
 * override (the card's unsaved Engine Directory / Engine Fork edits), the
 * same rule the launch request applies. Absent values fall back to the
 * stored config.
 */
export interface GetRequest {
    engine?: string;
    config?: Config;
    platform?: StoredPlatformConfig;
}
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
 * depsRequestFromUrl parses the engine and config query params the GET routes
 * (summary, deps) read. An absent engine falls back to the stored engine, and
 * a config that cannot be parsed falls back to the stored config, the same
 * rule the POST routes apply to a broken body key.
 */
export declare function depsRequestFromUrl(url: URL): DepsRequest;
/**
 * launchRequestFromBody parses the launch and stop POST body: the engine,
 * config, and platform override the plan renders from, falling back to the
 * stored config per key. The stop route ignores the platform key.
 * `providerId` names the saved provider entry the launch record (or its
 * stop's clear) targets, and `autoRebuild` carries the card's Auto Rebuild
 * checkbox.
 */
export declare function launchRequestFromBody(body: Record<string, unknown>): LaunchRequest;
/**
 * registerRequestFromBody parses the register and unregister POST body: the
 * engine and config the plan renders from, plus agentDefault for the register
 * route, falling back to the stored config per key.
 */
export declare function registerRequestFromBody(body: Record<string, unknown>): RegisterRequest;
//# sourceMappingURL=request.d.ts.map