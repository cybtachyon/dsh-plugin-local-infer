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

// One NDJSON line the launch route streams: a step event as a phase begins,
// or the final result event. The result is the full launch result, or the
// broken-launch fallback that names the failure (a structurally smaller
// LaunchResult). The explicit undefined keys keep the union discriminable:
// a line carries a step or a result, never both.
export type LaunchStreamEvent =
  | { step: string; result?: undefined }
  | { step?: undefined; result: LaunchResult }

// The answer a launch settles to: the route's result event, or null when the
// stream ended without one (a host that cannot stream, a route that broke
// mid-stream).
export type LaunchResultEvent = LaunchResult | { healthy: false; detail: string }

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
 * final result event, handing each step event to onStep. A non-OK response
 * throws with the body text. A response with no streamable body (a host
 * that cannot stream) reads the whole body as the result JSON. A stream
 * that ends without a result event returns null, so the caller settles its
 * control to failed.
 */
export async function readLaunchStream(
  response: Response,
  onStep?: (step: string) => void,
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
    } else if (event.result !== undefined) {
      result = event.result
    }
  })
  return result
}

/**
 * readTextStream reads the get route's plain-text answer and hands each
 * decoded chunk to onChunk. A non-OK response throws with the body text. A
 * response with no streamable body reads the whole body at once.
 */
export async function readTextStream(
  response: Response,
  onChunk: (text: string) => void,
): Promise<void> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'HTTP ' + response.status)
  }
  if (response.body === null || typeof response.body.getReader !== 'function') {
    onChunk(await response.text())
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    onChunk(decoder.decode(value, { stream: true }))
  }
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
// response, so the stream readers can take it from there.
async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

/**
 * routeExists probes whether the host route is mounted: any response other
 * than a 404 (and other than a network failure) proves the route exists.
 * The bootstrap uses it to decide whether to mount the card, so a headless
 * profile (no web route) keeps the card off the Plugins page.
 */
export async function routeExists(): Promise<boolean> {
  try {
    const response = await fetch('/local-infer/summary')
    return response.status !== 404
  } catch {
    // A network failure (the host is unreachable) reads as absent.
    return false
  }
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
 * NDJSON stream, handing each step event to onStep and returning the final
 * result event (null when the stream ended without one).
 */
export async function postLaunch(
  request: LaunchRequest,
  onStep?: (step: string) => void,
): Promise<LaunchResultEvent | null> {
  const response = await post('/local-infer/launch', request)
  return readLaunchStream(response, onStep)
}

/** postStop signals the tracked process or container. */
export function postStop(request: LaunchRequest): Promise<{ stopped: boolean }> {
  return postJson<{ stopped: boolean }>('/local-infer/stop', request)
}

/**
 * postGet runs the git sync, the dependency plan, and the build through the
 * get route's text stream, handing each chunk to onChunk as it lands.
 */
export async function postGet(
  request: GetRequest,
  onChunk: (text: string) => void,
): Promise<void> {
  const response = await post('/local-infer/get', request)
  await readTextStream(response, onChunk)
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
