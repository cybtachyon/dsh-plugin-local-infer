/**
 * The card's API layer: typed fetch wrappers for the /local-infer/* routes
 * plus the stream readers the launch and get routes drive.
 *
 * Every wrapper is a thin typed round trip over the global fetch: the GET
 * routes (summary, deps) price the card's draft, and the POST routes
 * (save, install, register, unregister, launch, stop, get, download,
 * chat-template, provider-delete, orchestrator-save) mutate the host. A
 * JSON answer that is not OK throws with the route's error field, so the
 * caller's catch reads
 * the host's own message. The launch route streams NDJSON (a step event as
 * each phase begins, a sudo event when a sudo command waits for the password
 * on the host's CLI, a progress event when the Get-steps hf download's tqdm
 * output folds into a structured state, then a final result event), the
 * get route streams NDJSON progress events only (its log text moved to the
 * logs route, so a Get line never reaches the card twice), and the logs
 * route streams NDJSON per run key (a catch-up snapshot, then log, runBegin,
 * or runEnd events), which
 * subscribeRunLogs holds open. readNdjsonLines buffers
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
/** The body the orchestrator-save route takes. */
export interface OrchestratorSaveRequest {
    prompt: string;
}
/**
 * OrchestratorModel is the answer both orchestrator routes share: the
 * effective prompt, the shipped prompt.md default, and whether the effective
 * prompt is a saved value. The payload interface is private in the node-side
 * orchestrator package and the client bundle cannot import it, so the shape
 * is mirrored here; the two copies change together by hand.
 */
export interface OrchestratorModel {
    prompt: string;
    defaultPrompt: string;
    saved: boolean;
}
export interface HfProgressShape {
    step: string;
    percent: number;
    doneBytes: number;
    totalBytes: number;
    etaSeconds: number;
    unit: 'bytes' | 'files';
}
export type LaunchStreamEvent = {
    step: string;
    result?: undefined;
    progress?: undefined;
    sudo?: undefined;
} | {
    step?: undefined;
    result: LaunchResult;
    progress?: undefined;
    sudo?: undefined;
} | {
    step?: undefined;
    result?: undefined;
    progress: HfProgressShape;
    sudo?: undefined;
} | {
    step?: undefined;
    result?: undefined;
    progress?: undefined;
    sudo: true;
};
export type GetStreamEvent = {
    progress?: HfProgressShape;
};
export type RunLogsEvent = {
    snapshot: string;
    running: boolean;
    seq: number;
    log?: undefined;
    runBegin?: undefined;
    runEnd?: undefined;
} | {
    snapshot?: undefined;
    running?: undefined;
    seq: number;
    log: string;
    runBegin?: undefined;
    runEnd?: undefined;
} | {
    snapshot?: undefined;
    running?: undefined;
    seq: number;
    log?: undefined;
    runBegin: string;
    runEnd?: undefined;
} | {
    snapshot?: undefined;
    running?: undefined;
    seq: number;
    log?: undefined;
    runBegin?: undefined;
    runEnd: true;
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
 * final result event, handing each step event to onStep, each progress
 * event to onProgress, and calling the optional onSudo once per sudo event
 * (absent callbacks ignore their events, so a caller that only reads the
 * steps and the result is untouched). A sudo line never clears a collected
 * result: each line carries exactly one event kind. A non-OK response throws
 * with the body text. A response with no streamable body (a host that cannot
 * stream) reads the whole body as the result JSON. A stream that ends without
 * a result event returns null, so the caller settles its control to failed.
 */
export declare function readLaunchStream(response: Response, onStep?: (step: string) => void, onProgress?: (progress: HfProgressShape) => void, onSudo?: () => void): Promise<LaunchResultEvent | null>;
/**
 * readGetStream reads the get route's NDJSON answer and hands each progress
 * event to onProgress. The route carries no log lines anymore (the logs
 * route's stream is the run's one display path), so a line without a
 * progress state reads as nothing. A non-OK response throws with the body
 * text. A response with no streamable body (a host that cannot stream) has
 * no progress to hand and resolves quietly.
 */
export declare function readGetStream(response: Response, onProgress?: (progress: HfProgressShape) => void): Promise<void>;
/**
 * subscribeRunLogs holds the per-provider run-log NDJSON stream open (the
 * GET /local-infer/logs?provider=<key> route) and hands each event to
 * onEvent until the stream ends or the caller's signal aborts (its detach).
 * The key is the run-log key every run path shares; clientRunLogKey mirrors
 * the host's runLogKey rule so the card always names the buffer its own
 * requests write. A non-OK answer throws with the body text, and a body that
 * broke mid-stream rejects through readNdjsonLines' read; the store module
 * decides whether that break deserves its one reconnect (the stream may be
 * held across runs, so a clean end just resolves). The optional signal is the
 * pane's detach: the abort ends the in-flight body read.
 */
export declare function subscribeRunLogs(key: string, onEvent: (event: RunLogsEvent) => void, signal?: AbortSignal): Promise<void>;
/**
 * routeExists probes whether the host route is mounted (see probeRoute).
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
 * NDJSON stream, handing each step event to onStep and each sudo event to
 * the optional onSudo, and returning the final result event (null when the
 * stream ended without one). The optional signal is the card's cancel: an
 * abort closes the in-flight stream, and the route interrupts the in-flight
 * Get-step hf child on the host.
 */
export declare function postLaunch(request: LaunchRequest, onStep?: (step: string) => void, signal?: AbortSignal, onSudo?: () => void): Promise<LaunchResultEvent | null>;
/** postStop signals the tracked process or container. */
export declare function postStop(request: LaunchRequest): Promise<{
    stopped: boolean;
}>;
/**
 * postGet runs the git sync, the dependency plan, and the build through the
 * get route's NDJSON stream, handing each progress event to the optional
 * onProgress (the route's log text moved to the logs route's stream). The
 * optional signal is the card's cancel: an abort closes the in-flight
 * stream, and the route interrupts the in-flight hf child on the host.
 */
export declare function postGet(request: GetRequest, signal?: AbortSignal, onProgress?: (progress: HfProgressShape) => void): Promise<void>;
/** postDownload pulls the selected model into the model directory. */
export declare function postDownload(request: DownloadRequest): Promise<DownloadResult>;
/** postChatTemplate pulls the selected chat template into the model directory. */
export declare function postChatTemplate(request: ChatTemplateRequest): Promise<DownloadResult>;
/** postProviderDelete removes a saved provider entry and answers with the fresh summary. */
export declare function postProviderDelete(request: ProviderDeleteRequest): Promise<LocalInferSummary>;
/**
 * orchestratorRouteExists probes whether the orchestrator's GET route is
 * mounted (see probeRoute). The orchestrator component ships disabled, and
 * its routes live and die with the component, so the probe is the card's
 * enablement read.
 */
export declare function orchestratorRouteExists(): Promise<boolean>;
/** fetchOrchestrator reads the orchestrator prompt model (the GET /local-infer/orchestrator route). */
export declare function fetchOrchestrator(): Promise<OrchestratorModel>;
/** postOrchestratorSave persists the prompt and answers with the fresh model. */
export declare function postOrchestratorSave(request: OrchestratorSaveRequest): Promise<OrchestratorModel>;
//# sourceMappingURL=routes.d.ts.map
