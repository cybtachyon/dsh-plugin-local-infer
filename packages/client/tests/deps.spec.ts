import type { DepsModel, LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelInFlightRuns,
  clearInFlightRuns,
  hasInFlightGet,
} from '../src/store/abort.ts'
import {
  clearRunLogStreams,
  setLogsPaneMounted,
} from '../src/store/logs-stream.ts'
import {
  copyInstallString,
  GET_IDLE_MS,
  GET_PROGRESS_THROTTLE_MS,
  performAllowRun,
  performGet,
  performGetCancel,
  performInstall,
  repriceDeps,
} from '../src/store/deps.ts'
import { cardReducer } from '../src/store/reducer.ts'
import type { GetProgressState } from '../src/store/progress.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// makeStore builds a test store over the real reducer: dispatch reduces
// into the next snapshot, and getSnapshot reads it.
function makeStore() {
  let state: CardState = initialCardState()
  const store: CardStore = {
    dispatch(action) {
      state = cardReducer(state, action)
    },
    getSnapshot() {
      return state
    },
  }
  return { store, state: () => state }
}

// summaryWith builds the minimal summary the drivers read: the engine id,
// the config, and the persisted last-run logs the Get run seeds from.
function summaryWith(lastLogs: string = ''): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config: { model: 'a-model' },
    lastLogs,
  } as unknown as LocalInferSummary
}

// depsWith builds the minimal deps model the drivers read: the install
// string the copy hands to the clipboard, and the gate flags.
function depsWith(patch: Partial<DepsModel> = {}): DepsModel {
  return {
    engineId: 'ninfer',
    buildMode: 'docker',
    packageManager: 'apt',
    deps: [],
    allSatisfied: false,
    installString: 'apt install -y a-dep',
    runAllowed: false,
    ...patch,
  }
}

// prime seeds the store the way the card's first summary and deps acks do.
function prime(store: CardStore, deps: DepsModel | null = depsWith()): CardState {
  store.dispatch({ type: 'summary/ack', summary: summaryWith() })
  if (deps !== null) {
    store.dispatch({ type: 'deps/ack', deps })
  }
  return store.getSnapshot()
}

// trackProgressPatches wraps the store's dispatch and records every
// getProgress patch the driver dispatches, so the test reads the throttle's
// cadence (how many patches a burst of updates lands).
function trackProgressPatches(store: CardStore) {
  const patches: Array<GetProgressState | null> = []
  const original = store.dispatch
  store.dispatch = (action) => {
    if (action.type === 'ui/patch' && 'getProgress' in action.patch) {
      patches.push(action.patch.getProgress ?? null)
    }
    original(action)
  }
  return patches
}

// jsonFetch stubs the global fetch with a per-route JSON answer table and
// records the requests, so the test reads the body the driver posts. The
// table keys are paths: a query string on the request is stripped before
// the lookup.
function jsonFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    const path = url.split('?')[0]
    const route = routes[path] ?? { status: 404, body: { error: 'no such route' } }
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, fetchMock }
}

// streamResponse builds a /local-infer/get answer whose body streams NDJSON
// log events and stays open, so the test enqueues and closes by hand.
function streamResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: () => new Response(stream, { status: 200 }),
    enqueue: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
    fail: (message: string) => controller.error(new Error(message)),
  }
}

// logsStreams stubs the run-logs route: every call records the url and the
// request signal and answers with a hand-driven NDJSON stream (the run's
// hub-side lines), so the test drives the live feed on its own schedule. The
// signal abort errors the body, the way a live fetch ends a read.
function logsStreams() {
  const calls: Array<{ url: string; signal: AbortSignal | null }> = []
  const streams: Array<{
    enqueue: (line: string) => void
    close: () => void
    fail: (message: string) => void
  }> = []
  const answer = (url: string, init?: RequestInit): Response => {
    calls.push({ url, signal: init?.signal ?? null })
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const encoder = new TextEncoder()
    const stream = {
      enqueue: (line: string) => controller.enqueue(encoder.encode(line + '\n')),
      close: () => controller.close(),
      fail: (message: string) => controller.error(new Error(message)),
    }
    streams.push(stream)
    init?.signal?.addEventListener('abort', () => stream.fail('aborted'), { once: true })
    return new Response(body, { status: 200 })
  }
  return { calls, streams, answer }
}

describe('the deps panel drivers (store/deps.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The abort registry is module-level; start each test from an empty one so
    // an in-flight run from a prior test never reads as in flight here.
    clearInFlightRuns()
    // The run-log stream attach is module-level for the same reason.
    clearRunLogStreams()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('repriceDeps', () => {
    it('stores the deps model on the ack', async () => {
      const { store, state } = makeStore()
      const deps = depsWith()
      const { fetchMock } = jsonFetch({ '/local-infer/deps': { status: 200, body: deps } })
      vi.stubGlobal('fetch', fetchMock)
      await repriceDeps(store, { engine: 'ninfer' })
      expect(state().deps).toEqual(deps)
      expect(fetchMock).toHaveBeenCalledWith('/local-infer/deps?engine=ninfer')
    })

    it('clears the deps model on a fetch failure', async () => {
      const { store, state } = makeStore()
      prime(store)
      const { fetchMock } = jsonFetch({ '/local-infer/deps': { status: 500, body: { error: 'probe broke' } } })
      vi.stubGlobal('fetch', fetchMock)
      await repriceDeps(store)
      expect(state().deps).toBeNull()
      expect(state().notes.deps).toBe('')
    })
  })

  describe('copyInstallString', () => {
    it('no-ops without a deps model', () => {
      const { store, state } = makeStore()
      copyInstallString(store, t)
      expect(state().notes.copy).toBe('')
    })

    it('writes the install string to the clipboard and clears the note after two seconds', async () => {
      const { store, state } = makeStore()
      prime(store)
      const writeText = vi.fn(() => Promise.resolve())
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      copyInstallString(store, t)
      await vi.advanceTimersByTimeAsync(0)
      expect(writeText).toHaveBeenCalledWith('apt install -y a-dep')
      expect(state().notes.copy).toBe(t.copied)
      vi.advanceTimersByTime(2000)
      expect(state().notes.copy).toBe('')
    })

    it('reads as the copy-failed label without a clipboard', async () => {
      const { store, state } = makeStore()
      prime(store)
      vi.stubGlobal('navigator', {})
      copyInstallString(store, t)
      await vi.advanceTimersByTimeAsync(0)
      expect(state().notes.copy).toBe(t.copyFailed)
    })

    it('reads as the copy-failed label when the write rejects', async () => {
      const { store, state } = makeStore()
      prime(store)
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
      })
      copyInstallString(store, t)
      await vi.advanceTimersByTimeAsync(0)
      expect(state().notes.copy).toBe(t.copyFailed)
    })
  })

  describe('performAllowRun', () => {
    it('no-ops without a draft', async () => {
      const { store } = makeStore()
      const { fetchMock } = jsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await performAllowRun(store, true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('persists the gate as a settings-only save and re-prices the deps on the ack', async () => {
      const { store, state } = makeStore()
      prime(store)
      const deps = depsWith({ runAllowed: true })
      const summary = summaryWith()
      const { calls, fetchMock } = jsonFetch({
        '/local-infer/save': { status: 200, body: summary },
        '/local-infer/deps': { status: 200, body: deps },
      })
      vi.stubGlobal('fetch', fetchMock)
      await performAllowRun(store, true)
      const save = calls.find((call) => call.url === '/local-infer/save')
      expect(JSON.parse(String(save?.init.body))).toEqual({
        engine: 'ninfer',
        config: { model: 'a-model' },
        allowRunDeps: true,
        platform: {},
        showHelp: true,
        settingsOnly: true,
      })
      expect(state().summary).toEqual(summary)
      expect(state().deps).toEqual(deps)
      expect(state().actions.save).toEqual({ status: 'ok', detail: 'ok' })
    })

    it('re-prices nothing when the save fails', async () => {
      const { store, state } = makeStore()
      prime(store)
      const { fetchMock } = jsonFetch({
        '/local-infer/save': { status: 500, body: { error: 'save broke' } },
        '/local-infer/deps': { status: 200, body: depsWith() },
      })
      vi.stubGlobal('fetch', fetchMock)
      await performAllowRun(store, true)
      expect(state().actions.save).toEqual({ status: 'error', detail: 'save broke' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('performInstall', () => {
    it('no-ops without a deps model or a draft', async () => {
      const { store } = makeStore()
      const { fetchMock } = jsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await performInstall(store, t)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stores the re-checked deps and the satisfied note on a passed re-check', async () => {
      const { store, state } = makeStore()
      prime(store)
      const rechecked = depsWith({ allSatisfied: true })
      const { calls, fetchMock } = jsonFetch({
        '/local-infer/install': {
          status: 200,
          body: { result: { ok: true, results: [] }, deps: rechecked },
        },
      })
      vi.stubGlobal('fetch', fetchMock)
      await performInstall(store, t)
      const install = calls.find((call) => call.url === '/local-infer/install')
      expect(JSON.parse(String(install?.init.body))).toEqual({
        engine: 'ninfer',
        config: { model: 'a-model' },
      })
      expect(state().deps).toEqual(rechecked)
      expect(state().notes.deps).toBe(t.depsSatisfied)
      expect(state().actions.install).toEqual({ status: 'ok', detail: 'ok' })
    })

    it('names the unsatisfied deps on a failed re-check', async () => {
      const { store, state } = makeStore()
      prime(store)
      const rechecked = depsWith()
      const { fetchMock } = jsonFetch({
        '/local-infer/install': {
          status: 200,
          body: {
            result: {
              ok: false,
              results: [
                { id: 'git', status: 'satisfied' },
                { id: 'cuda', status: 'failed', detail: 'no driver' },
                { id: 'clang' },
              ],
            },
            deps: rechecked,
          },
        },
      })
      vi.stubGlobal('fetch', fetchMock)
      await performInstall(store, t)
      expect(state().notes.deps).toBe('cuda: no driver; clang')
    })

    it('settles the install cell to error with the route message on a refusal', async () => {
      const { store, state } = makeStore()
      prime(store)
      const { fetchMock } = jsonFetch({
        '/local-infer/install': { status: 409, body: { error: t.installRejected } },
      })
      vi.stubGlobal('fetch', fetchMock)
      await performInstall(store, t)
      expect(state().actions.install).toEqual({ status: 'error', detail: t.installRejected })
    })
  })

  describe('performGet', () => {
    it('no-ops without a deps model or a draft', async () => {
      const { store } = makeStore()
      const { fetchMock } = jsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await performGet(store, t)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('seeds the Logs buffer, leaves the streamed lines to the run-log stream, and re-reads the summary on the end', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith('old logs'),
      })
      const stream = streamResponse()
      const summary = summaryWith('new logs')
      const calls: Array<{ url: string; init: RequestInit }> = []
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init: init ?? {} })
        if (url === '/local-infer/get') {
          return stream.response()
        }
        return new Response(JSON.stringify(summary), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      // The get route's own log chunks no longer feed the buffer: the run's
      // live text reaches it through the attached run-log stream alone, so
      // the same line arriving on this stream never lands twice.
      stream.enqueue('{"log":"line one\\n"}\n')
      await vi.advanceTimersByTimeAsync(0)
      expect(state().ui.logs.getLogs).toBe('old logs\n--- ' + t.getting + '\n')
      stream.enqueue('{"log":"line two\\n"}\n')
      await vi.advanceTimersByTimeAsync(0)
      expect(state().ui.logs.getLogs).not.toContain('line two')
      // The pane is unmounted in this harness, so the driver attached no
      // run-log stream either.
      expect(calls.filter((call) => call.url.startsWith('/local-infer/logs'))).toHaveLength(0)
      stream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
      // The repriceAll settle re-read (both read models) hands the Logs
      // section back to the stored value.
      expect(state().ui.logs.getLogs).toBeNull()
      expect(state().summary).toEqual(summary)
      expect(state().actions.get).toEqual({ status: 'ok', detail: 'ok' })
      const get = calls.find((call) => call.url === '/local-infer/get')
      expect(JSON.parse(String(get?.init.body))).toEqual({
        engine: 'ninfer',
        config: { model: 'a-model' },
      })
    })

    it('brackets one run-log stream and lands each Get line exactly once', async () => {
      const { store, state } = makeStore()
      const getStream = streamResponse()
      const logs = logsStreams()
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/local-infer/get') {
          return Promise.resolve(getStream.response())
        }
        if (url.startsWith('/local-infer/logs')) {
          return Promise.resolve(logs.answer(url, init))
        }
        return Promise.resolve(
          new Response(JSON.stringify(summaryWith()), { status: 200 }),
        )
      })
      vi.stubGlobal('fetch', fetchMock)
      // The Logs pane is mounted (before the summary lands, so no catch-up
      // probe competes with the run's attach): the driver attaches the Get
      // run's stream under the mirrored key rule (no providerId names it,
      // the draft's engine and model find no stored entry, so the engine id).
      setLogsPaneMounted(store, true)
      prime(store, depsWith())
      const promise = performGet(store, t)
      await vi.advanceTimersByTimeAsync(0)
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=ninfer'])
      // The same line arrives on both readers: the get route's own NDJSON
      // (kept until TASK-005 drops it) and the run-log hub.
      getStream.enqueue('{"log":"cloning repo\\n"}\n')
      logs.streams[0].enqueue('{"log":"cloning repo\\n","seq":1}')
      await vi.advanceTimersByTimeAsync(0)
      const buffer = state().ui.logs.getLogs ?? ''
      // The line appears exactly once, after the client's seed.
      expect(buffer).toBe('--- ' + t.getting + '\ncloning repo\n')
      expect(buffer.match(/cloning repo/g)).toHaveLength(1)
      // The run settles and the driver detaches the stream.
      getStream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(logs.calls[0].signal?.aborted).toBe(true)
    })

    it('folds the tqdm log chunks into getProgress (throttled) and clears it on the settle', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const patches = trackProgressPatches(store)
      const stream = streamResponse()
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/get') {
          return stream.response()
        }
        return new Response('{}', { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const bar = (percent: number, done: string, total: string): string =>
        JSON.stringify({
          log: `Downloading x.safetensors: ${percent}% | ${done}/${total} [00:01<00:02, 1.0MB/s]\n`,
        }) + '\n'
      const promise = performGet(store, t)
      // A burst of tqdm chunks: the first patches immediately, and the rest
      // land inside the 500 ms window, so the throttle arms one timer for
      // the burst (no more than ~2 patches per second).
      stream.enqueue(bar(10, '5.0G', '50.0G'))
      await vi.advanceTimersByTimeAsync(0)
      stream.enqueue(bar(20, '10.0G', '50.0G'))
      stream.enqueue(bar(30, '15.0G', '50.0G'))
      stream.enqueue(bar(40, '20.0G', '50.0G'))
      await vi.advanceTimersByTimeAsync(0)
      expect(patches).toHaveLength(1)
      expect(state().ui.getProgress).toEqual({
        step: 'Downloading x.safetensors',
        percent: 10,
        doneBytes: 5.0e9,
        totalBytes: 50.0e9,
        etaSeconds: 2,
        unit: 'bytes',
      })
      // The Logs buffer no longer carries the get stream's chunks: the
      // attached run-log stream owns the live text, and the progress parse
      // is the get stream's only remaining reader.
      expect(state().ui.logs.getLogs).not.toContain('10%')
      // The window's end lands the latest state of the burst.
      await vi.advanceTimersByTimeAsync(GET_PROGRESS_THROTTLE_MS)
      expect(patches).toHaveLength(2)
      expect(state().ui.getProgress).toEqual({
        step: 'Downloading x.safetensors',
        percent: 40,
        doneBytes: 20.0e9,
        totalBytes: 50.0e9,
        etaSeconds: 2,
        unit: 'bytes',
      })
      // The settle lands the latest state (the final chunk), then clears the
      // field back to null: the readout must not outlive the run.
      stream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(patches[patches.length - 2]).toEqual({
        step: 'Downloading x.safetensors',
        percent: 40,
        doneBytes: 20.0e9,
        totalBytes: 50.0e9,
        etaSeconds: 2,
        unit: 'bytes',
      })
      expect(patches[patches.length - 1]).toBeNull()
      expect(state().ui.getProgress).toBeNull()
    })

    it('lands the structured progress event in getProgress (throttled) and lets it win over the text parse', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const patches = trackProgressPatches(store)
      const stream = streamResponse()
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/get') {
          return stream.response()
        }
        return new Response('{}', { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      // The text parse lands first (the fallback for hosts that stream log
      // text without progress events)...
      stream.enqueue(
        JSON.stringify({
          log: 'Downloading x.safetensors: 10% | 5.0G/50.0G [00:01<00:02, 1.0MB/s]\n',
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(state().ui.getProgress).toEqual({
        step: 'Downloading x.safetensors',
        percent: 10,
        doneBytes: 5.0e9,
        totalBytes: 50.0e9,
        etaSeconds: 2,
        unit: 'bytes',
      })
      // ...and the structured event (the server-parsed state) wins,
      // throttled to the window's end.
      const structured: GetProgressState = {
        step: 'Downloading x.safetensors',
        percent: 55,
        doneBytes: 27.5e9,
        totalBytes: 50.0e9,
        etaSeconds: 30,
        unit: 'bytes',
      }
      stream.enqueue(JSON.stringify({ progress: structured }) + '\n')
      await vi.advanceTimersByTimeAsync(0)
      // Inside the 500 ms window the patch is held, so the readout keeps the
      // text-parsed state until the window's end.
      expect(patches).toHaveLength(1)
      expect(state().ui.getProgress).toEqual({
        step: 'Downloading x.safetensors',
        percent: 10,
        doneBytes: 5.0e9,
        totalBytes: 50.0e9,
        etaSeconds: 2,
        unit: 'bytes',
      })
      await vi.advanceTimersByTimeAsync(GET_PROGRESS_THROTTLE_MS)
      expect(patches).toHaveLength(2)
      expect(state().ui.getProgress).toEqual(structured)
      // A later text parse never overwrites the server-parsed state.
      stream.enqueue(
        JSON.stringify({
          log: 'Downloading x.safetensors: 60% | 30.0G/50.0G [00:02<00:01, 1.0MB/s]\n',
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(GET_PROGRESS_THROTTLE_MS)
      expect(state().ui.getProgress).toEqual(structured)
      // The get stream's log chunks stay out of the Logs buffer now (the
      // run-log stream carries the run's live text; TASK-005 drops the
      // route's log events).
      expect(state().ui.logs.getLogs).not.toContain('10%')
      expect(state().ui.logs.getLogs).not.toContain('60%')
      stream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(state().ui.getProgress).toBeNull()
    })

    it('re-enables the control at the idle cap while the run keeps streaming', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const stream = streamResponse()
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/get') {
          return stream.response()
        }
        return new Response('{}', { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      // A silent stream: no chunk re-arms the cap, so the idle settle (armed
      // before the action deadline) fires at the cap and re-enables the
      // control while the run keeps streaming in the background.
      await vi.advanceTimersByTimeAsync(GET_IDLE_MS)
      expect(state().actions.get).toEqual({ status: 'ok', detail: 'idle' })
      stream.enqueue('{"log":"line one\\n"}\n')
      await vi.advanceTimersByTimeAsync(0)
      // The background chunk still re-arms the idle cap for the live run,
      // but it no longer feeds the Logs buffer (the run-log stream does).
      expect(state().ui.logs.getLogs).not.toContain('line one')
      stream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
    })

    it('no-ops a second click while a run is in flight (no concurrent run)', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const stream = streamResponse()
      let getCalls = 0
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/get') {
          getCalls++
          return stream.response()
        }
        return new Response('{}', { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      // Advance to the idle cap: the cell settles to ok (re-enabled) while the
      // run keeps streaming in the background, so the in-flight registry is
      // still populated.
      await vi.advanceTimersByTimeAsync(GET_IDLE_MS)
      expect(state().actions.get).toEqual({ status: 'ok', detail: 'idle' })
      // A second click while the run is in flight is a no-op: no concurrent
      // postGet starts, so the get route is hit exactly once.
      await performGet(store, t)
      expect(getCalls).toBe(1)
      // Settle the in-flight run so the registry is empty for the next test.
      // The cell keeps the idle cap's detail: the idle settle already resolved
      // the action promise, so the later stream-end resolve('ok') is a no-op.
      stream.close()
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(state().actions.get).toEqual({ status: 'ok', detail: 'idle' })
    })

    it('appends the failure line and re-reads the summary when the stream breaks', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const stream = streamResponse()
      const summary = summaryWith()
      // The repriceAll settle re-read stays gated, so the failure line is
      // observable in the buffer before the re-read clears it.
      let resolveSummary: (response: Response) => void = () => {}
      const summaryGate = new Promise<Response>((resolve) => {
        resolveSummary = resolve
      })
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/get') {
          return stream.response()
        }
        return summaryGate
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      stream.enqueue('{"log":"line one\\n"}\n')
      await vi.advanceTimersByTimeAsync(0)
      stream.fail('the build broke')
      await vi.advanceTimersByTimeAsync(0)
      // The stream's line one stays out of the buffer (the run-log stream
      // would have carried it); the client's own failure line still appends.
      expect(state().ui.logs.getLogs).toBe(
        '--- ' + t.getting + '\n\n' + t.getFailed + ': the build broke\n',
      )
      resolveSummary(new Response(JSON.stringify(summary), { status: 200 }))
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(state().ui.logs.getLogs).toBeNull()
      expect(state().actions.get).toEqual({ status: 'error', detail: 'the build broke' })
      expect(state().summary).toEqual(summary)
    })

    it('settles without a failure line when the Cancel aborts the run', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      const stream = streamResponse()
      // The repriceAll settle re-read stays gated, so the buffer is
      // observable before the re-read clears it.
      let resolveSummary: (response: Response) => void = () => {}
      const summaryGate = new Promise<Response>((resolve) => {
        resolveSummary = resolve
      })
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/local-infer/get') {
          return new Promise<Response>((resolve) => {
            // The card's provider-form Cancel closes the stream through the
            // run's signal, the same way the live fetch errors the body
            // stream on an abort.
            init?.signal?.addEventListener(
              'abort',
              () => stream.fail('The operation was aborted.'),
              { once: true },
            )
            resolve(stream.response())
          })
        }
        return summaryGate
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      stream.enqueue('{"log":"line one\\n"}\n')
      await vi.advanceTimersByTimeAsync(0)
      // The provider form's Cancel: abort the in-flight run.
      expect(cancelInFlightRuns()).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      await promise
      // The aborted run settles the get cell to error with the abort message,
      // and the buffer keeps the streamed lines without a failure line (the
      // "Canceled" line the Cancel wrote is the run's tail).
      expect(state().actions.get).toEqual({
        status: 'error',
        detail: 'The operation was aborted.',
      })
      expect(state().ui.logs.getLogs).toBe('--- ' + t.getting + '\n')
      // The run is no longer in flight: a second cancel reads as nothing to
      // abort.
      expect(cancelInFlightRuns()).toBe(false)
      resolveSummary(new Response('{}', { status: 200 }))
      await vi.advanceTimersByTimeAsync(0)
      expect(state().ui.logs.getLogs).toBeNull()
    })
  })

  describe('performGetCancel', () => {
    it('aborts the in-flight Get, appends the Canceled line, clears getProgress, and leaves the form open', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith('old logs'),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'staged' } },
      })
      const stream = streamResponse()
      // The repriceAll settle re-read stays gated, so the buffer is
      // observable before the re-read clears it.
      let resolveSummary: (response: Response) => void = () => {}
      const summaryGate = new Promise<Response>((resolve) => {
        resolveSummary = resolve
      })
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/local-infer/get') {
          return new Promise<Response>((resolve) => {
            // The cancel closes the stream through the run's signal, the same
            // way the live fetch errors the body stream on an abort.
            init?.signal?.addEventListener(
              'abort',
              () => stream.fail('The operation was aborted.'),
              { once: true },
            )
            resolve(stream.response())
          })
        }
        return summaryGate
      })
      vi.stubGlobal('fetch', fetchMock)
      const promise = performGet(store, t)
      // A tqdm chunk lands the progress readout, so the cancel has a live
      // getProgress to clear.
      stream.enqueue(
        JSON.stringify({
          log: 'Downloading x.safetensors: 10% | 5.0G/50.0G [00:01<00:02, 1.0MB/s]\n',
        }) + '\n',
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(state().ui.getProgress).not.toBeNull()
      expect(hasInFlightGet()).toBe(true)
      // The cancel: abort the in-flight run, keep the form open.
      performGetCancel(store)
      expect(hasInFlightGet()).toBe(false)
      // The "Canceled" line lands in the buffer as the run's tail (the tqdm
      // chunk itself stays out: the run-log stream would have carried it).
      expect(state().ui.logs.getLogs).toBe(
        'old logs\n--- ' + t.getting + '\n\n--- Canceled\n',
      )
      // The readout clears, and the form stays open (the draft and the form
      // mode are untouched, unlike cancelProvider).
      expect(state().ui.getProgress).toBeNull()
      expect(state().ui.providerFormMode).toBe('editing')
      expect(state().ui.editingProviderId).toBe('p1')
      expect(state().draft).toEqual({ engine: 'ninfer', config: { model: 'staged' } })
      // The aborted run settles the get cell to error through performGet's
      // settle path, so the 'getting' control branch stops firing.
      await vi.advanceTimersByTimeAsync(0)
      expect(state().actions.get).toEqual({
        status: 'error',
        detail: 'The operation was aborted.',
      })
      resolveSummary(new Response('{}', { status: 200 }))
      await vi.advanceTimersByTimeAsync(0)
      await promise
      // The repriceAll settle re-read (both read models) hands the Logs
      // section back to the stored value.
      expect(state().ui.logs.getLogs).toBeNull()
    })

    it('no-ops the Canceled line when no run is in flight', async () => {
      const { store, state } = makeStore()
      prime(store, depsWith())
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      const { fetchMock } = jsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      performGetCancel(store)
      // Nothing was aborted: no "Canceled" line lands, the readout stays
      // null, and the form stays open.
      expect(state().ui.logs.getLogs).toBeNull()
      expect(state().ui.getProgress).toBeNull()
      expect(state().ui.providerFormMode).toBe('editing')
      expect(state().ui.editingProviderId).toBe('p1')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
