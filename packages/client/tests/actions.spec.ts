import type {
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  performDiscard,
  performDownload,
  performRegister,
  performSave,
  performUnregister,
} from '../src/store/actions.ts'
import { cardReducer } from '../src/store/reducer.ts'
import {
  performDraftLaunch,
  performDraftStop,
} from '../src/store/providers.ts'
import { clearRunLogStreams, setLogsPaneMounted } from '../src/store/logs-stream.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// makeStore builds a test store over the real reducer.
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

function providerWith(patch: Partial<ProviderSummaryEntry> = {}): ProviderSummaryEntry {
  return {
    id: 'p1',
    engine: 'ninfer',
    model: 'a-model',
    status: 'stopped',
    config: { model: 'a-model' },
    platform: { engineDirectory: '/eng/ninfer' },
    ...patch,
  }
}

function summaryWith(
  providers: ProviderSummaryEntry[] = [],
  lastLogs = '',
): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config: { model: 'a-model' },
    providers,
    lastLogs,
    engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
  } as unknown as LocalInferSummary
}

// routeFetch stubs the global fetch with a per-route answer table.
function routeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    const path = url.split('?')[0]
    const factory = routes[path]
    if (factory === undefined) {
      return new Response(JSON.stringify({ error: 'no such route' }), { status: 404 })
    }
    return factory()
  })
  return { calls, fetchMock }
}

function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// launchStream builds a /local-infer/launch answer whose body streams NDJSON.
function launchStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: (): Response =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    enqueue: (line: string) => controller.enqueue(encoder.encode(line + '\n')),
    close: () => controller.close(),
  }
}

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function seedDraft(store: CardStore, provider?: ProviderSummaryEntry): void {
  store.dispatch({
    type: 'summary/ack',
    summary: summaryWith(provider !== undefined ? [provider] : []),
  })
  store.dispatch({
    type: 'draft/load',
    draft: {
      engine: 'ninfer',
      config: { model: 'a-model' },
      platform: {},
    },
  })
}

describe('the form server-mutation drivers (store/actions.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearRunLogStreams()
  })

  it('performSave upserts the entry, stores the fresh summary, and collapses the form', async () => {
    const { store, state } = makeStore()
    const provider = providerWith()
    seedDraft(store, provider)
    store.dispatch({ type: 'ui/patch', patch: { editingProviderId: 'p1' } })
    const { calls, fetchMock } = routeFetch({
      '/local-infer/save': () => jsonAnswer(summaryWith([provider])),
      '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performSave(store, t)
    expect(state().actions.save.status).toBe('pending')
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.save.status).toBe('ok')
    expect(state().actions.save.detail).toBe(t.saved)
    // The form collapsed back to the entry list.
    expect(state().ui.editingProviderId).toBeNull()
    expect(state().ui.providerFormMode).toBe('collapsed')
    // A draft with no checkbox edit saves the entry as unchecked.
    const save = calls.find((call) => call.url === '/local-infer/save')
    expect(JSON.parse(String(save?.init?.body)).autoRebuild).toBe(false)
  })

  it('performSave records the draft autoRebuild value with the entry', async () => {
    const { store } = makeStore()
    const provider = providerWith()
    seedDraft(store, provider)
    store.dispatch({
      type: 'draft/edit',
      draft: {
        engine: 'ninfer',
        config: { model: 'a-model' },
        platform: {},
        autoRebuild: true,
      },
    })
    store.dispatch({ type: 'ui/patch', patch: { editingProviderId: 'p1' } })
    const { calls, fetchMock } = routeFetch({
      '/local-infer/save': () => jsonAnswer(summaryWith([provider])),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performSave(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    const save = calls.find((call) => call.url === '/local-infer/save')
    expect(JSON.parse(String(save?.init?.body)).autoRebuild).toBe(true)
  })

  it('performDiscard reverts the draft and collapses the form (local-only)', async () => {
    const { store, state } = makeStore()
    const provider = providerWith()
    seedDraft(store, provider)
    store.dispatch({ type: 'draft/edit', draft: { engine: 'ninfer', config: { model: 'edited' } } })
    expect(state().dirty).toBe(true)
    store.dispatch({ type: 'ui/patch', patch: { sudoPending: true } })
    const { fetchMock } = routeFetch({
      '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    performDiscard(store)
    await flush()
    expect(state().dirty).toBe(false)
    expect(state().ui.editingProviderId).toBeNull()
    expect(state().ui.providerFormMode).toBe('collapsed')
    // The Discard abandons a draft run's sudo wait through the shared
    // abandonedFormPatch, so a stale flag can never paint a later form.
    expect(state().ui.sudoPending).toBe(false)
  })

  it('performRegister publishes the model and re-fetches the summary', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/register': () =>
        jsonAnswer({ ok: true, entry: { providerId: 'p1', modelId: 'a-model' } }),
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performRegister(store, t)
    expect(state().actions.register.status).toBe('pending')
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.register.status).toBe('ok')
    expect(state().actions.register.detail).toBe(t.registered + ' a-model as p1')
  })

  it('performUnregister removes the model row', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/unregister': () => jsonAnswer({ removed: true }),
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performUnregister(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.unregister.status).toBe('ok')
    expect(state().actions.unregister.detail).toBe(t.unregistered)
  })

  it('performDownload pulls the model and re-fetches the summary', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/download': () => jsonAnswer({ ok: true }),
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDownload(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.download.status).toBe('ok')
    expect(state().actions.download.detail).toBe(t.downloaded)
  })
})

describe('the form driver error paths and guards (store/actions.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearRunLogStreams()
  })

  it('a driver with no draft resolves without a round trip', async () => {
    const { store, state } = makeStore()
    // No draft loaded: the save, register, unregister, and download drivers
    // all resolve without touching the network.
    const { calls, fetchMock } = routeFetch({
      '/local-infer/save': () => jsonAnswer({}),
      '/local-infer/register': () => jsonAnswer({ ok: true }),
      '/local-infer/unregister': () => jsonAnswer({ removed: true }),
      '/local-infer/download': () => jsonAnswer({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([
      performSave(store, t),
      performRegister(store, t),
      performUnregister(store, t),
      performDownload(store, t),
    ])
    expect(calls).toHaveLength(0)
    expect(state().actions.save.status).toBe('idle')
  })

  it('performRegister settles to error when the route refuses the write', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/register': () => jsonAnswer({ ok: false, detail: 'model exists' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performRegister(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.register.status).toBe('error')
    expect(state().actions.register.detail).toBe(t.registerFailed + ': model exists')
  })

  it('performUnregister settles to error when nothing was removed', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/unregister': () => jsonAnswer({ removed: false }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performUnregister(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.unregister.status).toBe('error')
    expect(state().actions.unregister.detail).toBe(t.unregisterFailed)
  })

  it('performDownload settles to error when the pull fails', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/download': () => jsonAnswer({ ok: false, detail: 'no such model' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDownload(store, t)
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.download.status).toBe('error')
    expect(state().actions.download.detail).toBe(t.downloadFailed + ': no such model')
  })
})

describe('the draft-based launch/stop guards (store/providers.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearRunLogStreams()
  })

  it('performDraftLaunch resolves without a round trip when there is no draft', async () => {
    const { store, state } = makeStore()
    const { calls, fetchMock } = routeFetch({
      '/local-infer/launch': () => jsonAnswer({ healthy: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await performDraftLaunch(store, t)
    expect(calls).toHaveLength(0)
    expect(state().actions.launch.status).toBe('idle')
  })

  it('performDraftLaunch settles to error when the result is not healthy', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const stream = launchStream()
    const { fetchMock } = routeFetch({
      '/local-infer/launch': () => stream.response(),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDraftLaunch(store, t)
    vi.advanceTimersByTime(0)
    stream.enqueue('{"result":{"healthy":false,"detail":"no gpu"}}')
    stream.close()
    await flush(50)
    await promise
    expect(state().actions.launch.status).toBe('error')
    expect(state().actions.launch.detail).toBe(t.notHealthy + ': no gpu')
  })

  it('performDraftLaunch settles to error when the stream ends without a result', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const stream = launchStream()
    const { fetchMock } = routeFetch({
      '/local-infer/launch': () => stream.response(),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDraftLaunch(store, t)
    vi.advanceTimersByTime(0)
    // The stream ends with no result event: the launch reads as failed.
    stream.close()
    await flush(50)
    await promise
    expect(state().actions.launch.status).toBe('error')
    expect(state().actions.launch.detail).toBe(t.launchFailed)
  })

  it('performDraftStop resolves without a round trip when there is no draft', async () => {
    const { store, state } = makeStore()
    const { calls, fetchMock } = routeFetch({
      '/local-infer/stop': () => jsonAnswer({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await performDraftStop(store, t)
    expect(calls).toHaveLength(0)
    expect(state().actions.stop.status).toBe('idle')
  })
})

describe('the draft-based launch/stop drivers (store/providers.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearRunLogStreams()
  })

  it('performDraftLaunch reads the stream, settles the launch cell, and re-prices', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const stream = launchStream()
    const { fetchMock } = routeFetch({
      '/local-infer/launch': stream.response,
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDraftLaunch(store, t)
    expect(state().actions.launch.status).toBe('pending')
    stream.enqueue('{"step":"launch"}')
    stream.enqueue('{"result":{"healthy":true,"plan":{"port":11435}}}')
    stream.close()
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.launch.status).toBe('ok')
    expect(state().actions.launch.detail).toBe(t.runningOn + ' 11435')
  })

  it('performDraftStop signals the stop and settles the stop cell', async () => {
    const { store, state } = makeStore()
    seedDraft(store)
    const { fetchMock } = routeFetch({
      '/local-infer/stop': () => jsonAnswer({ ok: true }),
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const promise = performDraftStop(store, t)
    expect(state().actions.stop.status).toBe('pending')
    vi.advanceTimersByTime(0)
    await flush()
    await promise
    expect(state().actions.stop.status).toBe('ok')
    expect(state().actions.stop.detail).toBe(t.stopped)
  })

  it('performDraftStop brackets one run-log stream for the run key', async () => {
    const { store } = makeStore()
    // The draft is the stored provider's config, so the mirrored key rule
    // names the entry id (the same key the host's stop route writes).
    seedDraft(store, providerWith())
    const calls: Array<{ url: string; signal: AbortSignal | null }> = []
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c
      },
    })
    const { fetchMock } = routeFetch({
      '/local-infer/stop': () => jsonAnswer({ ok: true }),
      '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith()])),
      '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
    })
    const logsFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? null })
      init?.signal?.addEventListener(
        'abort',
        () => {
          try {
            streamController.error(new Error('The operation was aborted.'))
          } catch {
            // The reader is gone already: the abort just ends the pass.
          }
        },
        { once: true },
      )
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    })
    const combined = vi.fn(async (url: string, init?: RequestInit) =>
      url.startsWith('/local-infer/logs') ? logsFetch(url, init) : fetchMock(url, init),
    )
    vi.stubGlobal('fetch', combined)
    // The Logs pane is mounted: the mount's catch-up probe opens the
    // engine-id key first (a stopped summary falls to the engine guess),
    // and the one-pair stream attach the other drivers use brackets this
    // round trip on the run key.
    setLogsPaneMounted(store, true)
    const promise = performDraftStop(store, t)
    await vi.advanceTimersByTimeAsync(0)
    await flush()
    await promise
    expect(calls.map((call) => call.url)).toEqual([
      '/local-infer/logs?provider=ninfer',
      '/local-infer/logs?provider=p1',
    ])
    // The run-key attach detached the replaced probe, and the settle
    // detached the run's own stream.
    expect(calls[0]!.signal?.aborted).toBe(true)
    expect(calls[1]!.signal?.aborted).toBe(true)
  })
})
