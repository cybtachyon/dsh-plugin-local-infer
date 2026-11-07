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

import type {
  Config,
  DepsModel,
  DownloadResult,
  InstallResponse,
  LaunchResult,
  LocalInferSummary,
  RegisterResult,
  StoredPlatformConfig,
} from 'dsh-plugin-local-infer/ui'

/**
 * The query the summary and deps GET routes take: the engine and the config
 * the price reads from. Absent values fall back to the stored config, the
 * same rule the routes apply.
 */
export interface PriceQuery {
  engine?: string
  config?: Config
}

/** The body the save route takes. */
export interface SaveRequest {
  engine?: string
  config?: Config
  allowRunDeps?: boolean
  platform?: Record<string, StoredPlatformConfig>
  showHelp?: boolean
  logPath?: string
  // The card's Auto Rebuild checkbox, recorded on the upserted provider
  // entry. Absent on a settings-only save, which never touches the list.
  autoRebuild?: boolean
  // The provider entry the save upserts in place. Absent for a settings-only
  // save (the help and allow-run toggles), which never mints an entry.
  id?: string
  settingsOnly?: boolean
}

/** The body the install route takes. */
export interface InstallRequest {
  engine?: string
  config?: Config
}

/** The body the register and unregister routes take. */
export interface RegisterRequest {
  engine?: string
  config?: Config
  agentDefault?: boolean
}

/** The body the launch and stop routes take. */
export interface LaunchRequest {
  engine?: string
  config?: Config
  // The card's unsaved Engine Directory / Engine Fork edits for the engine,
  // so a launch uses them without a prior save.
  platform?: Record<string, StoredPlatformConfig>
  // The saved provider entry the launch record (or the stop's clear)
  // targets. Absent while the draft is not a provider.
  providerId?: string
  // The Auto Rebuild checkbox: false skips the git sync (fetch, rebase,
  // rebuild) and launches the checkout as-is. The stop route ignores it.
  autoRebuild?: boolean
}

/** The body the get route takes. */
export interface GetRequest {
  engine?: string
  config?: Config
  // The card's unsaved platform edit for the engine (a single per-engine
  // config, not the record the save route takes).
  platform?: StoredPlatformConfig
}

/** The body the download route takes. */
export interface DownloadRequest {
  engine?: string
  model?: string
  directory?: string
}

/** The body the chat-template route takes. */
export interface ChatTemplateRequest {
  engine?: string
  template?: string
  directory?: string
}

/** The body the provider-delete route takes. */
export interface ProviderDeleteRequest {
  id: string
}

/** The body the orchestrator-save route takes. */
export interface OrchestratorSaveRequest {
  prompt: string
}

/**
 * OrchestratorModel is the answer both orchestrator routes share: the
 * effective prompt, the shipped prompt.md default, and whether the effective
 * prompt is a saved value. The payload interface is private in the node-side
 * orchestrator package and the client bundle cannot import it, so the shape
 * is mirrored here; the two copies change together by hand.
 */
export interface OrchestratorModel {
  prompt: string
  defaultPrompt: string
  saved: boolean
}

// HfProgressShape is the structured download progress state the routes'
// progress events carry (the core HfProgress shape, mirrored here because
// the client bundle cannot import the node-side core package): the step
// label the tqdm bar names, the percent complete, the done and total
// amounts (bytes for a file download, file counts for a multi-file fetch),
// the remaining time in seconds, and the unit the done/total amounts carry
// ('bytes' for the byte bar, 'files' for the file-count bar), so a readout
// renders the amounts in the unit the bar measured.
export interface HfProgressShape {
  step: string
  percent: number
  doneBytes: number
  totalBytes: number
  etaSeconds: number
  unit: 'bytes' | 'files'
}

// One NDJSON line the launch route streams: a step event as a phase begins,
// a sudo event when a sudo command starts waiting for the password on the
// host's CLI, a progress event when the Get-steps hf download's tqdm output
// folds into a structured state, or the final result event. The result is
// the full launch result, or the broken-launch fallback that names the
// failure (a structurally smaller LaunchResult). The explicit undefined keys
// keep the union discriminable: a line carries a step, a sudo, a progress,
// or a result, never two at once.
export type LaunchStreamEvent =
  | { step: string; result?: undefined; progress?: undefined; sudo?: undefined }
  | { step?: undefined; result: LaunchResult; progress?: undefined; sudo?: undefined }
  | { step?: undefined; result?: undefined; progress: HfProgressShape; sudo?: undefined }
  | { step?: undefined; result?: undefined; progress?: undefined; sudo: true }

// One NDJSON line the get route streams: the structured download progress
// state. The route's log events are gone (the logs route's stream carries
// the run's text, so no line lands twice); a stale log line simply carries
// no progress and reads as nothing. The shape mirrors the route's answer in
// packages/ui/src/routes/get.ts; the two copies change together by hand.
export type GetStreamEvent = { progress?: HfProgressShape }

// RunLogsEvent is one NDJSON line the logs route streams for a run key: the
// catch-up snapshot (the bounded buffer text, the seq it reached, and the
// running flag), one appended log chunk, a run begin (the new run's seed
// line, so the pane replaces its display), or the run end. The union mirrors
// the route's LogsStreamEvent in packages/ui/src/routes/logs.ts (the client
// bundle cannot import the node-side ui package, so the shape is mirrored
// here; the two copies change together by hand). Every line carries the seq
// the next append continues; the route already dedups against the snapshot
// it sent on this connection, so the reader applies no seq rule of its own.
// The explicit undefined keys keep the union discriminable: a line carries a
// snapshot, a log, a runBegin, or a runEnd, never two at once.
export type RunLogsEvent =
  | {
      snapshot: string
      running: boolean
      seq: number
      log?: undefined
      runBegin?: undefined
      runEnd?: undefined
    }
  | {
      snapshot?: undefined
      running?: undefined
      seq: number
      log: string
      runBegin?: undefined
      runEnd?: undefined
    }
  | {
      snapshot?: undefined
      running?: undefined
      seq: number
      log?: undefined
      runBegin: string
      runEnd?: undefined
    }
  | {
      snapshot?: undefined
      running?: undefined
      seq: number
      log?: undefined
      runBegin?: undefined
      runEnd: true
    }

// The answer a launch settles to: the route's result event. The plan is
// optional, so a full result (with the launch plan) and a broken-launch
// fallback (a result that names the failure without a plan) share one shape.
// A caller reads result.healthy, result.state, and result.detail directly,
// with no union narrowing. readLaunchStream returns this or null when the
// stream ended without a result event (a host that cannot stream, a route
// that broke mid-stream).
export type LaunchResultEvent = Omit<LaunchResult, 'plan'> & {
  plan?: LaunchResult['plan']
}

/**
 * readNdjsonLines reads an NDJSON stream and hands each parsed line to
 * onEvent. It buffers chunks into whole lines: a line split across chunk
 * boundaries completes on the next chunk, a partial final line (a stream
 * that ends without a trailing newline) is still parsed, and a line that
 * does not parse as JSON is skipped, so one broken line never breaks the
 * stream.
 */
export async function readNdjsonLines<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleLine = (line: string): void => {
    if (line === '') {
      return
    }
    try {
      onEvent(JSON.parse(line) as T)
    } catch {
      // A line that is not JSON is not an event; skip it.
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      handleLine(line)
    }
  }
  // The stream ended: a final line without a trailing newline is still an
  // event (the route's result event), so flush it.
  handleLine(buffer)
}

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
export async function readLaunchStream(
  response: Response,
  onStep?: (step: string) => void,
  onProgress?: (progress: HfProgressShape) => void,
  onSudo?: () => void,
): Promise<LaunchResultEvent | null> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'HTTP ' + response.status)
  }
  if (response.body === null || typeof response.body.getReader !== 'function') {
    return (await response.json()) as LaunchResultEvent
  }
  let result: LaunchResultEvent | null = null
  await readNdjsonLines<LaunchStreamEvent>(response.body, (event) => {
    if (event.step !== undefined) {
      onStep?.(event.step)
    } else if (event.sudo === true) {
      onSudo?.()
    } else if (event.progress !== undefined) {
      onProgress?.(event.progress)
    } else if (event.result !== undefined) {
      result = event.result
    }
  })
  return result
}

/**
 * readGetStream reads the get route's NDJSON answer and hands each progress
 * event to onProgress. The route carries no log lines anymore (the logs
 * route's stream is the run's one display path), so a line without a
 * progress state reads as nothing. A non-OK response throws with the body
 * text. A response with no streamable body (a host that cannot stream) has
 * no progress to hand and resolves quietly.
 */
export async function readGetStream(
  response: Response,
  onProgress?: (progress: HfProgressShape) => void,
): Promise<void> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'HTTP ' + response.status)
  }
  if (response.body === null || typeof response.body.getReader !== 'function') {
    // Drain the body so the connection closes; there is no log path to feed.
    await response.text()
    return
  }
  await readNdjsonLines<GetStreamEvent>(response.body, (event) => {
    if (event.progress !== undefined) {
      onProgress?.(event.progress)
    }
  })
}

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
export async function subscribeRunLogs(
  key: string,
  onEvent: (event: RunLogsEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams()
  params.set('provider', key)
  const response = await fetch('/local-infer/logs?' + params.toString(), {
    ...(signal !== undefined ? { signal } : {}),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'HTTP ' + response.status)
  }
  if (response.body === null || typeof response.body.getReader !== 'function') {
    // A host that cannot stream has nothing to hand the live pane; the
    // store's quiet end (and the summary's lastLogs) covers it.
    return
  }
  await readNdjsonLines<RunLogsEvent>(response.body, onEvent)
}

// withQuery builds the query string a GET route takes: the engine and the
// JSON-encoded config, each absent when undefined.
function withQuery(path: string, query?: PriceQuery): string {
  const params = new URLSearchParams()
  if (query?.engine) {
    params.set('engine', query.engine)
  }
  if (query?.config) {
    params.set('config', JSON.stringify(query.config))
  }
  const suffix = params.toString()
  return suffix ? path + '?' + suffix : path
}

// getJson reads a GET route's typed JSON answer. A non-OK response throws
// with the route's error field.
async function getJson<T>(path: string, query?: PriceQuery): Promise<T> {
  const response = await fetch(withQuery(path, query))
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(json.error ?? 'HTTP ' + response.status)
  }
  return json
}

// post sends a JSON POST body to a /local-infer route and returns the raw
// response, so the stream readers can take it from there. The optional signal
// is the card's cancel: an abort closes the in-flight stream, and the route
// interrupts the in-flight hf child on the host.
async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal !== undefined ? { signal } : {}),
  })
}

// postJson sends a JSON POST body and parses the typed JSON answer. A
// non-OK response throws with the route's error field.
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await post(path, body)
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(json.error ?? 'HTTP ' + response.status)
  }
  return json
}

// probeRoute answers the bootstrap's presence check for one route: any
// response other than a 404 proves the route exists. A network failure (the
// host is unreachable) reads as absent.
async function probeRoute(path: string): Promise<boolean> {
  try {
    const response = await fetch(path)
    return response.status !== 404
  } catch {
    return false
  }
}

/**
 * routeExists probes whether the host route is mounted (see probeRoute).
 * The bootstrap uses it to decide whether to mount the card, so a headless
 * profile (no web route) keeps the card off the Plugins page.
 */
export function routeExists(): Promise<boolean> {
  return probeRoute('/local-infer/summary')
}

/** fetchSummary reads the card's read model (the GET /local-infer/summary route). */
export function fetchSummary(query?: PriceQuery): Promise<LocalInferSummary> {
  return getJson<LocalInferSummary>('/local-infer/summary', query)
}

/** fetchDeps reads the deps panel model (the GET /local-infer/deps route). */
export function fetchDeps(query?: PriceQuery): Promise<DepsModel> {
  return getJson<DepsModel>('/local-infer/deps', query)
}

/** postSave upserts a provider entry and persists the global fields. */
export function postSave(request: SaveRequest): Promise<LocalInferSummary> {
  return postJson<LocalInferSummary>('/local-infer/save', request)
}

/** postInstall runs the Play/Run path and answers with the re-checked deps. */
export function postInstall(request: InstallRequest): Promise<InstallResponse> {
  return postJson<InstallResponse>('/local-infer/install', request)
}

/** postRegister publishes the engine as a DSH model. */
export function postRegister(request: RegisterRequest): Promise<RegisterResult> {
  return postJson<RegisterResult>('/local-infer/register', request)
}

/** postUnregister removes the DSH model row the register step wrote. */
export function postUnregister(request: RegisterRequest): Promise<{ removed: boolean }> {
  return postJson<{ removed: boolean }>('/local-infer/unregister', request)
}

/**
 * postLaunch runs the deploy and the health poll through the launch route's
 * NDJSON stream, handing each step event to onStep and each sudo event to
 * the optional onSudo, and returning the final result event (null when the
 * stream ended without one). The optional signal is the card's cancel: an
 * abort closes the in-flight stream, and the route interrupts the in-flight
 * Get-step hf child on the host.
 */
export async function postLaunch(
  request: LaunchRequest,
  onStep?: (step: string) => void,
  signal?: AbortSignal,
  onSudo?: () => void,
): Promise<LaunchResultEvent | null> {
  const response = await post('/local-infer/launch', request, signal)
  return readLaunchStream(response, onStep, undefined, onSudo)
}

/** postStop signals the tracked process or container. */
export function postStop(request: LaunchRequest): Promise<{ stopped: boolean }> {
  return postJson<{ stopped: boolean }>('/local-infer/stop', request)
}

/**
 * postGet runs the git sync, the dependency plan, and the build through the
 * get route's NDJSON stream, handing each progress event to the optional
 * onProgress (the route's log text moved to the logs route's stream). The
 * optional signal is the card's cancel: an abort closes the in-flight
 * stream, and the route interrupts the in-flight hf child on the host.
 */
export async function postGet(
  request: GetRequest,
  signal?: AbortSignal,
  onProgress?: (progress: HfProgressShape) => void,
): Promise<void> {
  const response = await post('/local-infer/get', request, signal)
  await readGetStream(response, onProgress)
}

/** postDownload pulls the selected model into the model directory. */
export function postDownload(request: DownloadRequest): Promise<DownloadResult> {
  return postJson<DownloadResult>('/local-infer/download', request)
}

/** postChatTemplate pulls the selected chat template into the model directory. */
export function postChatTemplate(request: ChatTemplateRequest): Promise<DownloadResult> {
  return postJson<DownloadResult>('/local-infer/chat-template', request)
}

/** postProviderDelete removes a saved provider entry and answers with the fresh summary. */
export function postProviderDelete(
  request: ProviderDeleteRequest,
): Promise<LocalInferSummary> {
  return postJson<LocalInferSummary>('/local-infer/provider-delete', request)
}

/**
 * orchestratorRouteExists probes whether the orchestrator's GET route is
 * mounted (see probeRoute). The orchestrator component ships disabled, and
 * its routes live and die with the component, so the probe is the card's
 * enablement read.
 */
export function orchestratorRouteExists(): Promise<boolean> {
  return probeRoute('/local-infer/orchestrator')
}

/** fetchOrchestrator reads the orchestrator prompt model (the GET /local-infer/orchestrator route). */
export function fetchOrchestrator(): Promise<OrchestratorModel> {
  return getJson<OrchestratorModel>('/local-infer/orchestrator')
}

/** postOrchestratorSave persists the prompt and answers with the fresh model. */
export function postOrchestratorSave(
  request: OrchestratorSaveRequest,
): Promise<OrchestratorModel> {
  return postJson<OrchestratorModel>('/local-infer/orchestrator/save', request)
}
