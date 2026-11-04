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
import type { Config, DepsModel, DownloadResult, InstallResponse, LaunchResult, LocalInferSummary, RegisterResult, StoredPlatformConfig } from 'dsh-plugin-local-infer/ui';
/**
 * The query the summary and deps GET routes take: the engine and the config
 * the price reads from. Absent values fall back to the stored config, the
 * same rule the routes apply.
 */
export interface PriceQuery {
    engine?: string;
    config?: Config;
}
/** The body the save route takes. */
export interface SaveRequest {
    engine?: string;
    config?: Config;
    allowRunDeps?: boolean;
    platform?: Record<string, StoredPlatformConfig>;
    showHelp?: boolean;
    logPath?: string;
    id?: string;
    settingsOnly?: boolean;
}
/** The body the install route takes. */
export interface InstallRequest {
    engine?: string;
    config?: Config;
}
/** The body the register and unregister routes take. */
export interface RegisterRequest {
    engine?: string;
    config?: Config;
    agentDefault?: boolean;
}
/** The body the launch and stop routes take. */
export interface LaunchRequest {
    engine?: string;
    config?: Config;
    platform?: Record<string, StoredPlatformConfig>;
    providerId?: string;
    autoRebuild?: boolean;
}
/** The body the get route takes. */
export interface GetRequest {
    engine?: string;
    config?: Config;
    platform?: StoredPlatformConfig;
}
/** The body the download route takes. */
export interface DownloadRequest {
    engine?: string;
    model?: string;
    directory?: string;
}
/** The body the chat-template route takes. */
export interface ChatTemplateRequest {
    engine?: string;
    template?: string;
    directory?: string;
}
/** The body the provider-delete route takes. */
export interface ProviderDeleteRequest {
    id: string;
}
export type LaunchStreamEvent = {
    step: string;
    result?: undefined;
} | {
    step?: undefined;
    result: LaunchResult;
};
export type LaunchResultEvent = Omit<LaunchResult, 'plan'> & {
    plan?: LaunchResult['plan'];
};
/**
 * readNdjsonLines reads an NDJSON stream and hands each parsed line to
 * onEvent. It buffers chunks into whole lines: a line split across chunk
 * boundaries completes on the next chunk, a partial final line (a stream
 * that ends without a trailing newline) is still parsed, and a line that
 * does not parse as JSON is skipped, so one broken line never breaks the
 * stream.
 */
export declare function readNdjsonLines<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void>;
/**
 * readLaunchStream reads the launch route's NDJSON answer and returns the
 * final result event, handing each step event to onStep. A non-OK response
 * throws with the body text. A response with no streamable body (a host
 * that cannot stream) reads the whole body as the result JSON. A stream
 * that ends without a result event returns null, so the caller settles its
 * control to failed.
 */
export declare function readLaunchStream(response: Response, onStep?: (step: string) => void): Promise<LaunchResultEvent | null>;
/**
 * readTextStream reads the get route's plain-text answer and hands each
 * decoded chunk to onChunk. A non-OK response throws with the body text. A
 * response with no streamable body reads the whole body at once.
 */
export declare function readTextStream(response: Response, onChunk: (text: string) => void): Promise<void>;
/**
 * routeExists probes whether the host route is mounted: any response other
 * than a 404 (and other than a network failure) proves the route exists.
 * The bootstrap uses it to decide whether to mount the card, so a headless
 * profile (no web route) keeps the card off the Plugins page.
 */
export declare function routeExists(): Promise<boolean>;
/** fetchSummary reads the card's read model (the GET /local-infer/summary route). */
export declare function fetchSummary(query?: PriceQuery): Promise<LocalInferSummary>;
/** fetchDeps reads the deps panel model (the GET /local-infer/deps route). */
export declare function fetchDeps(query?: PriceQuery): Promise<DepsModel>;
/** postSave upserts a provider entry and persists the global fields. */
export declare function postSave(request: SaveRequest): Promise<LocalInferSummary>;
/** postInstall runs the Play/Run path and answers with the re-checked deps. */
export declare function postInstall(request: InstallRequest): Promise<InstallResponse>;
/** postRegister publishes the engine as a DSH model. */
export declare function postRegister(request: RegisterRequest): Promise<RegisterResult>;
/** postUnregister removes the DSH model row the register step wrote. */
export declare function postUnregister(request: RegisterRequest): Promise<{
    removed: boolean;
}>;
/**
 * postLaunch runs the deploy and the health poll through the launch route's
 * NDJSON stream, handing each step event to onStep and returning the final
 * result event (null when the stream ended without one). The optional signal
 * is the card's cancel: an abort closes the in-flight stream, and the route
 * interrupts the in-flight Get-step hf child on the host.
 */
export declare function postLaunch(request: LaunchRequest, onStep?: (step: string) => void, signal?: AbortSignal): Promise<LaunchResultEvent | null>;
/** postStop signals the tracked process or container. */
export declare function postStop(request: LaunchRequest): Promise<{
    stopped: boolean;
}>;
/**
 * postGet runs the git sync, the dependency plan, and the build through the
 * get route's text stream, handing each chunk to onChunk as it lands. The
 * optional signal is the card's cancel: an abort closes the in-flight stream,
 * and the route interrupts the in-flight hf child on the host.
 */
export declare function postGet(request: GetRequest, onChunk: (text: string) => void, signal?: AbortSignal): Promise<void>;
/** postDownload pulls the selected model into the model directory. */
export declare function postDownload(request: DownloadRequest): Promise<DownloadResult>;
/** postChatTemplate pulls the selected chat template into the model directory. */
export declare function postChatTemplate(request: ChatTemplateRequest): Promise<DownloadResult>;
/** postProviderDelete removes a saved provider entry and answers with the fresh summary. */
export declare function postProviderDelete(request: ProviderDeleteRequest): Promise<LocalInferSummary>;
//# sourceMappingURL=routes.d.ts.map
