import type {
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachRunLogStream,
  beginRun,
  clearRunLogStreams,
  clientRunLogKey,
  endRun,
  RECONNECT_BACKOFF_MS,
  retargetRunLogs,
  setLogsPaneMounted,
} from '../src/store/logs-stream.ts'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'

// makeStore builds a test store over the real reducer: dispatch reduces into
// the next snapshot, and getSnapshot reads it.
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

// providerWith builds a stored provider entry the key rule and the pane
// target read.
function providerWith(patch: Partial<ProviderSummaryEntry> = {}): ProviderSummaryEntry {
  return {
    id: 'p1',
    engine: 'ninfer',
    model: 'a-model',
    status: 'stopped',
    config: { model: 'a-model' },
    platform: {},
    ...patch,
  }
}

// summaryWith builds the minimal summary the target rule reads: the engine id
// and the provider list.
function summaryWith(providers: ProviderSummaryEntry[] = []): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config: { model: 'a-model' },
    providers,
    lastLogs: '',
  } as unknown as LocalInferSummary
}

// logsStreams stubs the run-logs route: every call records the url and the
// request signal and answers with a hand-driven NDJSON stream, so the test
// enqueues snapshot/log/runBegin/runEnd lines and ends each pass on its own
// schedule. The signal abort errors the body, the way a live fetch ends an
// in-flight read.
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
      enqueue: (line: string) => {
        try {
          controller.enqueue(encoder.encode(line + '\n'))
        } catch {
          // A stream whose reader was aborted (or closed) drops the line,
          // the way a detached connection loses what the host appends after.
        }
      },
      close: () => controller.close(),
      fail: (message: string) => controller.error(new Error(message)),
    }
    streams.push(stream)
    init?.signal?.addEventListener('abort', () => stream.fail('The operation was aborted.'), {
      once: true,
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
  }
  return { calls, streams, answer }
}

// stubLogs wires the stubbed fetch to the route stub (or to a custom answer
// for the failure tests).
function stubLogs(logs: ReturnType<typeof logsStreams>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => logs.answer(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// flush settles the stream-read microtasks the reader chains through.
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('clientRunLogKey (the host runLogKey rule mirrored)', () => {
  const providers = [
    providerWith(),
    providerWith({ id: 'p2', model: 'b-model', config: { model: 'b-model' } }),
  ]

  it('names the providerId when the request names one', () => {
    expect(clientRunLogKey(providers, 'ninfer', { model: 'other' }, 'p2')).toBe('p2')
  })

  it('falls through a blank providerId to the engine+model match', () => {
    expect(clientRunLogKey(providers, 'ninfer', { model: 'b-model' }, '   ')).toBe('p2')
  })

  it('matches the stored entry by engine and model', () => {
    expect(clientRunLogKey(providers, 'ninfer', { model: 'b-model' })).toBe('p2')
    expect(clientRunLogKey(providers, 'ninfer', { model: 'a-model' })).toBe('p1')
  })

  it('falls to the engine id when no entry carries the engine', () => {
    expect(clientRunLogKey(providers, 'llamacpp', { model: 'a-model' })).toBe('llamacpp')
  })

  it('falls to the engine id for an unsaved model edit, as the host does', () => {
    expect(clientRunLogKey(providers, 'ninfer', { model: 'staged' })).toBe('ninfer')
  })

  it('falls to the engine id when the config names no model', () => {
    expect(clientRunLogKey(providers, 'ninfer', {})).toBe('ninfer')
    expect(clientRunLogKey([], 'ninfer', { model: 'a-model' })).toBe('ninfer')
  })
})

describe('the live run-log stream (store/logs-stream.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The attach and the run bookkeeping are module-level; start each test
    // from an empty slate.
    clearRunLogStreams()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('the buffer feed', () => {
    it('snapshot replaces the live buffer', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=p1'])
      logs.streams[0].enqueue('{"snapshot":"prior tail text\\n","seq":3,"running":true}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('prior tail text\n')
    })

    it('log appends and runBegin replaces the live buffer', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"first\\n","seq":1,"running":true}')
      logs.streams[0].enqueue('{"log":"second\\n","seq":2}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('first\nsecond\n')
      logs.streams[0].enqueue('{"runBegin":"--- Launching...\\n","seq":0}')
      logs.streams[0].enqueue('{"log":"building\\n","seq":1}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('--- Launching...\nbuilding\n')
    })

    it('a runEnd ends the key in-flight marker, and a later break ends quietly', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"run text\\n","seq":1,"running":true}')
      logs.streams[0].enqueue('{"runEnd":true,"seq":1}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('run text\n')
      logs.streams[0].fail('connection reset')
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      // The run settled: the break ends quietly, no reconnect re-opened it.
      expect(logs.calls).toHaveLength(1)
    })

    it('keeps a snapshot-replaced buffer when the stream later breaks quietly', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"full run text\\n","seq":9,"running":true}')
      await flush()
      logs.streams[0].close()
      // A clean pass end during a run spends the single reconnect; the
      // buffer survives the gap.
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS)
      expect(logs.calls).toHaveLength(2)
      expect(state().ui.logs.getLogs).toBe('full run text\n')
    })
  })

  describe('reconnect', () => {
    it('reconnects once with backoff when the stream breaks mid-run', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"before the break\\n","seq":1,"running":true}')
      await flush()
      logs.streams[0].fail('connection reset')
      await flush()
      // The retry waits the backoff.
      expect(logs.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS)
      await flush()
      expect(logs.calls.map((call) => call.url)).toEqual([
        '/local-infer/logs?provider=p1',
        '/local-infer/logs?provider=p1',
      ])
      // The retry's snapshot catch-up replaces the buffer.
      logs.streams[1].enqueue('{"snapshot":"caught up\\n","seq":5,"running":true}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('caught up\n')
      // The retry is the single one: a second break ends quietly.
      logs.streams[1].fail('connection reset again')
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      expect(logs.calls).toHaveLength(2)
    })

    it('reconnects on a clean pass end while the client-side marker still holds', async () => {
      // The client started the run but the host had not begun it when the
      // snapshot read (running=false): the local marker, not the host flag,
      // keeps the reconnect budget for the coming run.
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"","seq":0,"running":false}')
      await flush()
      logs.streams[0].close()
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS)
      await flush()
      expect(logs.calls).toHaveLength(2)
    })

    it('ends quietly on a stream break with no run in flight', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].fail('connection reset')
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      expect(logs.calls).toHaveLength(1)
    })

    it('a fetch failure is a quiet no-op that never feeds the buffer', async () => {
      const { store, state } = makeStore()
      store.dispatch({ type: 'summary/ack', summary: summaryWith() })
      const fetchMock = vi.fn(async () => {
        throw new Error('no network')
      })
      vi.stubGlobal('fetch', fetchMock)
      setLogsPaneMounted(store, true)
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(state().ui.logs.getLogs).toBeNull()
    })

    it('a not-OK answer is a quiet end', async () => {
      const { store } = makeStore()
      const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
      vi.stubGlobal('fetch', fetchMock)
      attachRunLogStream(store, 'p1')
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('an answer with no stream body is a quiet end', async () => {
      const { store } = makeStore()
      const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      attachRunLogStream(store, 'p1')
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS * 2)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('detach paths', () => {
    it('the handle detach aborts the stream and drops later events', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      const handle = attachRunLogStream(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"base\\n","seq":1,"running":true}')
      await flush()
      handle.detach()
      handle.detach() // idempotent
      expect(logs.calls[0].signal?.aborted).toBe(true)
      logs.streams[0].enqueue('{"log":"late line\\n","seq":2}')
      await flush()
      expect(state().ui.logs.getLogs).toBe('base\n')
    })

    it('endRun detaches the stream the driver started', async () => {
      const { store, state } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      beginRun(store, 'p1')
      await flush()
      logs.streams[0].enqueue('{"snapshot":"run\\n","seq":1,"running":true}')
      await flush()
      endRun(store, 'p1')
      expect(logs.calls[0].signal?.aborted).toBe(true)
      expect(state().ui.logs.getLogs).toBe('run\n')
      // The pane target is gone with the run: a retarget attaches nothing.
      retargetRunLogs(store)
      expect(logs.calls).toHaveLength(1)
    })

    it('the pane unmount detaches the attached stream', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      beginRun(store, 'p1')
      await flush()
      setLogsPaneMounted(store, false)
      expect(logs.calls[0].signal?.aborted).toBe(true)
    })

    it('endRun falls back to the edited provider target', async () => {
      const { store } = makeStore()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([providerWith(), providerWith({ id: 'p2', model: 'b-model' })]),
      })
      store.dispatch({ type: 'ui/patch', patch: { editingProviderId: 'p2' } })
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      await flush()
      // The mount attaches the edited provider (Q3: the edited provider
      // leads the target).
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=p2'])
      beginRun(store, 'p1')
      await flush()
      // The run start switches the pane target to the run (Q3: the latest
      // started run), detaching p2's stream.
      expect(logs.calls.map((call) => call.url)).toEqual([
        '/local-infer/logs?provider=p2',
        '/local-infer/logs?provider=p1',
      ])
      logs.streams[1].enqueue('{"snapshot":"p1 run\\n","seq":1,"running":true}')
      endRun(store, 'p1')
      expect(logs.calls[1].signal?.aborted).toBe(true)
      await flush()
      // The settle hands the pane back to the edited provider (Q3).
      expect(logs.calls.map((call) => call.url)).toEqual([
        '/local-infer/logs?provider=p2',
        '/local-infer/logs?provider=p1',
        '/local-infer/logs?provider=p2',
      ])
    })
  })

  describe('the single attach and the pane target (Q3)', () => {
    it('reuses the attach for the same key and replaces it on another key', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      attachRunLogStream(store, 'p1')
      const second = attachRunLogStream(store, 'p1')
      await flush()
      // The single-attach invariant: the same key never opens a second one.
      expect(logs.calls).toHaveLength(1)
      expect(second).toBeDefined()
      const third = attachRunLogStream(store, 'p2')
      await flush()
      expect(logs.calls[0].signal?.aborted).toBe(true)
      expect(logs.calls.map((call) => call.url)).toEqual([
        '/local-infer/logs?provider=p1',
        '/local-infer/logs?provider=p2',
      ])
      expect(third).toBeDefined()
    })

    it('names the stream with the url-encoded provider key', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      attachRunLogStream(store, 'my engine')
      await flush()
      expect(logs.calls[0].url).toBe('/local-infer/logs?provider=my+engine')
    })

    it('mounts the pane on the summary-reported running provider', async () => {
      const { store } = makeStore()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([
          providerWith({ id: 'p1' }),
          providerWith({ id: 'p2', engine: 'llamacpp', model: 'b-model', status: 'running' }),
        ]),
      })
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      await flush()
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=p2'])
    })

    it('retargets the attach to the edited provider on an editing switch', async () => {
      const { store } = makeStore()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([providerWith(), providerWith({ id: 'p2', model: 'b-model' })]),
      })
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      await flush()
      // The mount's catch-up guesses the engine key (nothing runs, nothing
      // is edited); the run start switches the target off that probe.
      beginRun(store, 'p1')
      await flush()
      store.dispatch({ type: 'ui/patch', patch: { editingProviderId: 'p2' } })
      retargetRunLogs(store)
      await flush()
      // The target switch detaches the previous attach (the p1 run) before
      // attaching p2 (Q3).
      expect(logs.calls.map((call) => call.url)).toEqual([
        '/local-infer/logs?provider=ninfer',
        '/local-infer/logs?provider=p1',
        '/local-infer/logs?provider=p2',
      ])
      expect(logs.calls.map((call) => call.signal?.aborted)).toEqual([true, true, false])
    })

    it('the page-refresh catch-up detaches an idle probe and does not re-open it', async () => {
      const { store, state } = makeStore()
      store.dispatch({ type: 'summary/ack', summary: summaryWith() })
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      await flush()
      // Nothing local names a run: the probe guesses the summary's engine key.
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=ninfer'])
      logs.streams[0].enqueue('{"snapshot":"","seq":0,"running":false}')
      await flush()
      // The idle probe detached right away.
      expect(logs.calls[0].signal?.aborted).toBe(true)
      expect(state().ui.logs.getLogs).toBe('')
      // A re-render does not re-open the probed idle key.
      retargetRunLogs(store)
      await flush()
      expect(logs.calls).toHaveLength(1)
      // A run starting under the key re-opens it.
      beginRun(store, 'ninfer')
      await flush()
      expect(logs.calls).toHaveLength(2)
    })

    it('beginRun attaches nothing while the Logs pane is unmounted', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      beginRun(store, 'p1')
      await vi.advanceTimersByTimeAsync(0)
      expect(logs.calls).toHaveLength(0)
    })

    it('retarget detaches when the target is gone (form collapsed to no run)', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      beginRun(store, 'p1')
      await flush()
      endRun(store, 'p1')
      await flush()
      retargetRunLogs(store)
      // The run's endRun already detached: the pane holds no stream.
      expect(logs.calls).toHaveLength(1)
      expect(logs.calls[0].signal?.aborted).toBe(true)
    })
  })

  describe('clearRunLogStreams', () => {
    it('detaches the active stream and drops the run bookkeeping', async () => {
      const { store } = makeStore()
      const logs = logsStreams()
      stubLogs(logs)
      setLogsPaneMounted(store, true)
      beginRun(store, 'p1')
      await flush()
      clearRunLogStreams()
      expect(logs.calls[0].signal?.aborted).toBe(true)
      // The slate is empty: the pane reads as unmounted again.
      beginRun(store, 'p1')
      await flush()
      expect(logs.calls).toHaveLength(1)
    })
  })
})
