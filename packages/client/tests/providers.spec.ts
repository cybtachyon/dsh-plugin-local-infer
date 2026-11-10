import type {
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAUNCH_HEALTH_DEADLINE_MS,
  STOP_HEALTH_DEADLINE_MS,
  STOP_POLL_MS,
} from '../src/machine/launch.ts'
import {
  cancelProvider,
  deleteProvider,
  editProvider,
  newProvider,
  openEntryLogs,
  performDraftLaunch,
  performEntryLaunch,
  performEntryStop,
  SUDO_DEADLINE_MS,
} from '../src/store/providers.ts'
import { cardReducer } from '../src/store/reducer.ts'
import {
  clearRunLogStreams,
  setLogsPaneMounted,
} from '../src/store/logs-stream.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

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

// providerWith builds a provider entry the drivers read.
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

// summaryWith builds the minimal summary the drivers read: the engine list,
// the provider entries, and the persisted last-run logs the launch seeds from.
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

// routeFetch stubs the global fetch with a per-route answer table and records
// the requests, so the test reads the body the driver posts. The table values
// are factories, so a streamed answer (the launch route) stays open.
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

// jsonAnswer builds a JSON Response the GET and POST JSON routes answer with.
function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// launchStream builds a /local-infer/launch answer whose body streams NDJSON
// lines the test enqueues and closes by hand, so a step event and the result
// event land on the test's schedule.
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
    // The card's Cancel closes the stream through the run's signal, the same
    // way the live fetch errors the body stream on an abort.
    fail: (error: Error) => controller.error(error),
  }
}

// flush lets the stream reads and the driver's settle chain run to completion.
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

// logsStreams stubs the run-logs route: every call records the url and the
// request signal and answers with a hand-driven NDJSON stream (the run's
// hub-side lines). The signal abort errors the body, the way a live fetch
// ends a read.
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

describe('the provider list drivers (store/providers.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The run-log stream attach is module-level; start each test from an
    // empty slate.
    clearRunLogStreams()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('editProvider', () => {
    it('loads the provider into the form, caches the draft, and re-prices', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'other' } },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      editProvider(store, provider)
      await flush()
      expect(state().ui.editingProviderId).toBe('p1')
      expect(state().ui.providerFormMode).toBe('editing')
      expect(state().ui.cachedDraft).toEqual({
        engine: 'ninfer',
        config: { model: 'other' },
        platform: undefined,
      })
      expect(state().draft).toEqual({
        engine: 'ninfer',
        config: { model: 'a-model' },
        platform: { ninfer: { engineDirectory: '/eng/ninfer' } },
        // The entry stores no autoRebuild key: the checkbox loads unchecked.
        autoRebuild: false,
      })
      // A loaded provider reads as saved, not dirty.
      expect(state().dirty).toBe(false)
      // The re-price reads the loaded provider's engine and config.
      const summary = fetchMock.mock.calls.find(
        (call) => String(call[0]).startsWith('/local-infer/summary'),
      )
      expect(String(summary?.[0])).toContain('engine=ninfer')
    })

    it('defaults an entry without the stored autoRebuild key to unchecked', () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      editProvider(store, provider)
      expect(state().draft?.autoRebuild).toBe(false)
    })

    it('loads a stored autoRebuild true into the draft', () => {
      const { store, state } = makeStore()
      const provider = providerWith({ autoRebuild: true })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      editProvider(store, provider)
      expect(state().draft?.autoRebuild).toBe(true)
    })
  })

  describe('the Auto Rebuild save/reload regression', () => {
    it('reloads an entry saved unchecked as an explicit false and launches it with false', async () => {
      // The original bug: the flag lived only in card UI state, so every
      // save/reload reset the box to checked. The save route echoes the
      // stored false on the fresh summary entry, so a fresh store seeded
      // from that summary must read it back unchecked at both consumer
      // boundaries: the Edit load and the entry's own Launch.
      const { store, state } = makeStore()
      const saved = providerWith({ autoRebuild: false })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([saved]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([saved])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      editProvider(store, saved)
      // Representation pin: a stored false loads as an explicit false in
      // the draft (the key is present, not absent), the value the
      // checkbox renders unchecked from either representation.
      expect('autoRebuild' in (state().draft ?? {})).toBe(true)
      expect(state().draft?.autoRebuild).toBe(false)
      performEntryLaunch(store, saved, t)
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).autoRebuild).toBe(false)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })
  })

  describe('cancelProvider', () => {
    it('collapses the form and reverts the draft to the summary', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'staged' } },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      cancelProvider(store)
      await flush()
      expect(state().ui.editingProviderId).toBeNull()
      expect(state().ui.providerFormMode).toBe('collapsed')
      expect(state().dirty).toBe(false)
      // The draft reverted to the summary's stored config, not the staged edit.
      expect(state().draft?.config).toEqual({ model: 'a-model' })
    })

    it('reads as new-provider mode when no entries remain', async () => {
      const { store, state } = makeStore()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([]) })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      cancelProvider(store)
      await flush()
      expect(state().ui.providerFormMode).toBe('new')
    })

    it('clears ui.sudoPending so an abandoned draft run cannot paint the control', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing', sudoPending: true },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      cancelProvider(store, 'p1')
      await flush()
      // The Cancel abandoned the sudo wait: the flag is cleared so the form
      // control can never read "Sudo needed" for a run that is gone.
      expect(state().ui.sudoPending).toBe(false)
    })

    it('aborts the in-flight launch and appends the Canceled line to the Logs buffer', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      const stream = launchStream()
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/local-infer/launch') {
          return new Promise<Response>((resolve) => {
            // The provider form's Cancel closes the stream through the run's
            // signal, the same way the live fetch errors the body stream on
            // an abort.
            init?.signal?.addEventListener(
              'abort',
              () => stream.fail(new DOMException('The operation was aborted.', 'AbortError')),
              { once: true },
            )
            resolve(stream.response())
          })
        }
        if (url.startsWith('/local-infer/summary')) {
          return jsonAnswer(summaryWith([provider]))
        }
        return jsonAnswer({ engineId: 'ninfer' })
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      await flush()
      expect(state().launch['p1']?.status).toBe('prereqs')
      // The provider form's Cancel: abort the in-flight run and append the
      // "Canceled" line to the Logs buffer (the client's only line: the host
      // seeds the run, and the run-log stream carries its text; no stream
      // attaches here with the pane unmounted).
      cancelProvider(store, 'p1')
      expect(state().ui.logs.liveLogs).toBe('--- Canceled\n')
      // The form collapsed, and the aborted run settles the machine to
      // failed (the red Logs control re-opens the entry for a re-launch).
      expect(state().ui.editingProviderId).toBeNull()
      expect(state().ui.providerFormMode).toBe('collapsed')
      await flush(50)
      expect(state().launch['p1']?.status).toBe('failed')
    })
  })

  describe('newProvider', () => {
    it('restores the cached in-progress values into a fresh provider', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: {
          cachedDraft: { engine: 'ninfer', config: { model: 'in-progress' } },
        },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      newProvider(store)
      // Immediately, the draft is the cached in-progress values, and the form
      // reads as a fresh provider (not dirty).
      expect(state().ui.providerFormMode).toBe('new')
      expect(state().ui.editingProviderId).toBeNull()
      expect(state().draft).toEqual({
        engine: 'ninfer',
        config: { model: 'in-progress' },
      })
      expect(state().dirty).toBe(false)
      // The re-price keeps the draft's config (the cached in-progress values),
      // the improved config value display the T3.8 note requires: the freshly
      // loaded draft is not clobbered by the re-price it triggers.
      await flush()
      expect(state().draft?.config).toEqual({ model: 'in-progress' })
    })

    it('keeps the checkbox value through the cachedDraft round trip', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      // The form carries a checked Auto Rebuild edit before Edit opens the
      // stored entry (Edit caches it), so New provider must restore it.
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'in-progress' }, autoRebuild: true },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      editProvider(store, provider)
      expect(state().ui.cachedDraft?.autoRebuild).toBe(true)
      newProvider(store)
      await flush()
      expect(state().draft?.autoRebuild).toBe(true)
      expect(state().draft?.config).toEqual({ model: 'in-progress' })
    })

    it('clears ui.sudoPending when a fresh provider abandons the draft run', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({ type: 'ui/patch', patch: { sudoPending: true } })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      newProvider(store)
      await flush()
      expect(state().ui.sudoPending).toBe(false)
    })

    it('starts from the current engine and a blank config with no cache', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      newProvider(store)
      // Immediately, the draft is a fresh provider (the current engine, a
      // blank config, the current platform).
      expect(state().draft).toEqual({
        engine: 'ninfer',
        config: {},
        platform: {},
      })
      // A fresh draft carries no autoRebuild key: it reads as unchecked.
      expect('autoRebuild' in (state().draft ?? {})).toBe(false)
      // The re-price keeps the draft's config (the fresh provider's blank
      // config), the improved config value display the T3.8 note requires.
      await flush()
      expect(state().draft?.config).toEqual({})
    })
  })

  describe('deleteProvider', () => {
    it('removes the entry, stores the fresh summary, and clears the deleting flag', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const { calls, fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer(summaryWith([])),
      })
      vi.stubGlobal('fetch', fetchMock)
      await deleteProvider(store, 'p1')
      const del = calls.find((call) => call.url === '/local-infer/provider-delete')
      expect(JSON.parse(String(del?.init.body))).toEqual({ id: 'p1' })
      expect(state().summary?.providers).toEqual([])
      expect(state().ui.deletingProviderId).toBeNull()
    })

    it('stops editing the deleted entry and collapses the form', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer(summaryWith([])),
      })
      vi.stubGlobal('fetch', fetchMock)
      await deleteProvider(store, 'p1')
      expect(state().ui.editingProviderId).toBeNull()
      // The delete left no entries, so the form reads as new-provider mode.
      expect(state().ui.providerFormMode).toBe('new')
    })

    it('clears ui.sudoPending when the deleted entry was being edited', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing', sudoPending: true },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer(summaryWith([])),
      })
      vi.stubGlobal('fetch', fetchMock)
      await deleteProvider(store, 'p1')
      // The delete's form collapse rides the shared abandonedFormPatch, so
      // the abandoned draft run's sudo flag cannot paint a later form.
      expect(state().ui.sudoPending).toBe(false)
    })

    it('no-ops a second delete while one is in flight', async () => {
      const { store } = makeStore()
      // A delete in flight for another entry: the guard reads the flag.
      store.dispatch({ type: 'ui/patch', patch: { deletingProviderId: 'p1' } })
      const { calls, fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer(summaryWith([])),
      })
      vi.stubGlobal('fetch', fetchMock)
      await deleteProvider(store, 'p2')
      expect(calls).toHaveLength(0)
    })

    it('stores the route message on a failure and clears the deleting flag', async () => {
      const { store, state } = makeStore()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([providerWith()]),
      })
      const { fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer({ error: 'delete broke' }, 500),
      })
      vi.stubGlobal('fetch', fetchMock)
      await deleteProvider(store, 'p1')
      expect(state().summaryNote).toBe('delete broke')
      expect(state().ui.deletingProviderId).toBeNull()
    })
  })

  describe('openEntryLogs', () => {
    it('loads the entry for editing and resets the launch machine', () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      // Drive the machine to a phase, then to failed.
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'failed' } })
      expect(state().launch['p1']?.status).toBe('failed')
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      openEntryLogs(store, provider)
      expect(state().ui.editingProviderId).toBe('p1')
      expect(state().ui.providerFormMode).toBe('editing')
      // The failed state reset to idle, so the control reads as Launch again.
      expect(state().launch['p1']?.status).toBe('idle')
    })
  })

  describe('performEntryLaunch', () => {
    it('sends the stored autoRebuild value in the launch body', async () => {
      const { store } = makeStore()
      const provider = providerWith({ autoRebuild: true })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).autoRebuild).toBe(true)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })

    it('sends autoRebuild false for an entry stored without the key', async () => {
      const { store } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).autoRebuild).toBe(false)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })

    it('sends the platform as the single per-engine entry, not an engine-keyed record', async () => {
      // The host's parseStoredPlatformConfig reads the launch body's
      // platform as ONE StoredPlatformConfig; an engine-keyed record reads
      // as absent, so the wrap silently dropped the entry's Engine
      // Directory / Fork on every launch.
      const { store } = makeStore()
      const provider = providerWith({
        platform: { engineDirectory: '/eng/ninfer', engineFork: 'https://github.com/a/fork' },
      })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).platform).toEqual({
        engineDirectory: '/eng/ninfer',
        engineFork: 'https://github.com/a/fork',
      })
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })

    it('sends the draft override through the stored keys with the entry providerId', async () => {
      // The draft-aware launch (TASK-03): the title bar's Launch while the
      // form edits this entry runs the draft's engine, config, platform
      // entry, and Auto Rebuild checkbox through the same top-level keys,
      // and the launch record still targets the entry.
      const { store } = makeStore()
      const provider = providerWith({ autoRebuild: false })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'hyper-qwen' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t, {
        engine: 'hyper-qwen',
        config: { model: 'draft-model', ctx: 4096 },
        platform: {
          'hyper-qwen': { engineDirectory: '/eng/hq', engineFork: 'https://github.com/a/hq' },
        },
        autoRebuild: true,
      })
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body))).toEqual({
        engine: 'hyper-qwen',
        config: { model: 'draft-model', ctx: 4096 },
        platform: { engineDirectory: '/eng/hq', engineFork: 'https://github.com/a/hq' },
        providerId: 'p1',
        autoRebuild: true,
      })
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      // The settle re-price prices the engine and config that ran: the
      // draft's, not the entry's stored ones.
      const summary = calls.find((call) => call.url.startsWith('/local-infer/summary?'))
      const query = new URLSearchParams(String(summary?.url).split('?')[1] ?? '')
      expect(query.get('engine')).toBe('hyper-qwen')
      expect(JSON.parse(query.get('config') ?? 'null')).toEqual({
        model: 'draft-model',
        ctx: 4096,
      })
      // Launching never saves: nothing posts to the save route.
      expect(calls.filter((call) => call.url === '/local-infer/save')).toEqual([])
    })

    it('reads an absent draft platform entry as no override and autoRebuild as false', async () => {
      const { store } = makeStore()
      const provider = providerWith({ autoRebuild: true })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t, { engine: 'ninfer', config: { model: 'b-model' } })
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      // No platform key: the host falls back to the stored entry. The stored
      // autoRebuild true does NOT leak in: the draft's absence reads false.
      expect(JSON.parse(String(launch?.init?.body))).toEqual({
        engine: 'ninfer',
        config: { model: 'b-model' },
        providerId: 'p1',
        autoRebuild: false,
      })
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })

    it('keeps the stored body byte-identical without an override', async () => {
      const { store } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body))).toEqual({
        engine: 'ninfer',
        config: { model: 'a-model' },
        platform: { engineDirectory: '/eng/ninfer' },
        providerId: 'p1',
        autoRebuild: false,
      })
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
    })

    it('keys the run-log stream and the machine on the entry id with an override', async () => {
      // The mirrored runLogKey rule reads the request's providerId first, so
      // the draft's engine never moves the pane off the entry's run, and the
      // launch machine stays keyed on the entry.
      const { store, state } = makeStore()
      const provider = providerWith()
      const stream = launchStream()
      const logs = logsStreams()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/local-infer/launch') {
          return stream.response()
        }
        if (url.startsWith('/local-infer/logs')) {
          return logs.answer(url, init)
        }
        return jsonAnswer(summaryWith([provider]))
      })
      vi.stubGlobal('fetch', fetchMock)
      setLogsPaneMounted(store, true)
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      performEntryLaunch(store, provider, t, {
        engine: 'hyper-qwen',
        config: { model: 'draft-model' },
        autoRebuild: false,
      })
      await flush()
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=p1'])
      stream.enqueue('{"step":"prereqs"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('prereqs')
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(state().launch['p1']?.status).toBe('running')
    })

    it('ignores a launch while a rebuild phase is in flight', () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({
        type: 'launch/move',
        providerId: 'p1',
        event: { type: 'step', step: 'build' },
      })
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => jsonAnswer({ healthy: true }),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(state().launch['p1']?.status).toBe('build')
    })

    it('drives the machine through the stream and settles a healthy launch to running', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('prereqs')
      stream.enqueue('{"step":"build"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('build')
      // The build step wrote the "Building..." separator to the Logs buffer
      // (the client's only line: the host's "Launching..." seed and the run
      // text belong to the run-log stream, which no attach brings in here
      // with the pane unmounted).
      expect(state().ui.logs.liveLogs).toBe('--- ' + t.entryBuilding + '\n')
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(state().launch['p1']?.status).toBe('running')
      // The launch re-fetched the summary to repaint the status dot.
      const summary = calls.find((call) => call.url.startsWith('/local-infer/summary'))
      expect(summary).toBeDefined()
    })

    it('brackets one run-log stream for the provider key, detached at settle', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      const stream = launchStream()
      const logs = logsStreams()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/local-infer/launch') {
          return stream.response()
        }
        if (url.startsWith('/local-infer/logs')) {
          return logs.answer(url, init)
        }
        return jsonAnswer(summaryWith([provider]))
      })
      vi.stubGlobal('fetch', fetchMock)
      // A mounted Logs pane is what lets the run start attach its stream
      // (Q3: the latest started run is the pane target). Mounted before the
      // summary arrives, so no catch-up probe competes with the run's attach.
      setLogsPaneMounted(store, true)
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      performEntryLaunch(store, provider, t)
      await flush()
      // The key rule names the provider: the launch request carries its id.
      expect(logs.calls.map((call) => call.url)).toEqual(['/local-infer/logs?provider=p1'])
      logs.streams[0].enqueue(
        '{"snapshot":"engine output streaming\\n","seq":1,"running":true}',
      )
      await flush()
      // The run's live text reaches the Logs buffer through the stream,
      // replacing the client's seed with the host's own buffer.
      expect(state().ui.logs.liveLogs).toBe('engine output streaming\n')
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(state().launch['p1']?.status).toBe('running')
      // The run settled: the driver detached its stream.
      expect(logs.calls[0].signal?.aborted).toBe(true)
    })

    it('settles a downloading result to downloading', async () => {
      const { store, state } = makeStore()
      // The engine is up fetching its files: the detector sees the process
      // but cannot attribute a model yet (unsure), so the settle fold holds
      // the Downloading throbber instead of guessing.
      const provider = providerWith({ status: 'unsure' })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"result":{"healthy":false,"state":"downloading"}}')
      stream.close()
      await flush()
      expect(state().launch['p1']?.status).toBe('downloading')
      // The settle path from here is the summary status fold (see
      // foldDownloading in reducer.spec): a later ack reporting the
      // provider running turns the throbber into a Stop.
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([{ ...provider, status: 'running' }]),
      })
      expect(state().launch['p1']?.status).toBe('running')
    })

    it('settles a failed result to failed', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"result":{"healthy":false,"detail":"no gpu"}}')
      stream.close()
      await flush()
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('settles to failed when the stream ends without a result event', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}')
      stream.close()
      await flush()
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('forces a hung launch to failed at the health-poll deadline', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      // The launch step arms the deadline; a silent stream then hangs.
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      await vi.advanceTimersByTimeAsync(LAUNCH_HEALTH_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('cancel clears the deadline, so a late tick never moves the machine', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      const handle = performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      handle.cancel()
      await vi.advanceTimersByTimeAsync(LAUNCH_HEALTH_DEADLINE_MS)
      // The deadline was cleared on cancel, so the machine stays on the phase.
      expect(state().launch['p1']?.status).toBe('launch')
    })

    it('moves to sudo on a sudo event, writes the CLI note line, and fails at the sudo deadline', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider], 'old logs'),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}')
      await flush()
      stream.enqueue('{"sudo":true}')
      await flush()
      expect(state().launch['p1']?.status).toBe('sudo')
      // The note line is asserted literally (not through the client constant)
      // so the client's copy stays pinned to the host's core SUDO_CLI_NOTE.
      // It is the buffer's only line: the host seeds the run and the run-log
      // stream carries its text, and no stream attaches with the pane
      // unmounted here.
      expect(state().ui.logs.liveLogs).toBe('Check your CLI for a sudo prompt')
      // A password that never lands settles the control through the shared
      // failed path just past the host's 60 s kill.
      await vi.advanceTimersByTimeAsync(SUDO_DEADLINE_MS - 1)
      expect(state().launch['p1']?.status).toBe('sudo')
      await vi.advanceTimersByTimeAsync(1)
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('resumes the run after the sudo wait and clears the sudo deadline', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}\n{"sudo":true}')
      await flush()
      expect(state().launch['p1']?.status).toBe('sudo')
      // The user typed the password: the host reports the resumed step, and
      // the healthy result settles to running (the control becomes Stop).
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(state().launch['p1']?.status).toBe('running')
      // The settle cleared the armed deadline, so a late tick is a no-op.
      await vi.advanceTimersByTimeAsync(SUDO_DEADLINE_MS + LAUNCH_HEALTH_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('running')
    })

    it('hands the deadline to the health cap when a resumed sudo wait reaches the launch step', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}\n{"sudo":true}')
      await flush()
      expect(state().launch['p1']?.status).toBe('sudo')
      // The user typed the password: the launch step resumes the run, so the
      // sudo deadline is cleared and the health-poll cap owns the run.
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      // The stale 65 s sudo timer must not settle the run: past it the
      // legitimately launching engine is still on launch.
      await vi.advanceTimersByTimeAsync(SUDO_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('launch')
      // Past the 150 s health cap (armed at the launch step) the hung run
      // fails, confirming the health cap owns the deadline.
      await vi.advanceTimersByTimeAsync(LAUNCH_HEALTH_DEADLINE_MS - SUDO_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('never re-arms the sudo deadline once the health cap owns the slot', async () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryLaunch(store, provider, t)
      stream.enqueue('{"step":"prereqs"}\n{"sudo":true}')
      await flush()
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      // A late sudo event for the resumed run: armDeadline's single-owner
      // rule keeps the health cap in the slot, so the run cannot settle 65 s
      // into a legitimately launching engine.
      stream.enqueue('{"sudo":true}')
      await flush()
      expect(state().launch['p1']?.status).toBe('sudo')
      await vi.advanceTimersByTimeAsync(SUDO_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('sudo')
      await vi.advanceTimersByTimeAsync(LAUNCH_HEALTH_DEADLINE_MS - SUDO_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('failed')
    })
  })

  describe('performEntryStop', () => {
    it('sends the platform as the single per-engine entry, not an engine-keyed record', () => {
      // The stop route shares launchRequestFromBody, so the body carries the
      // same single-entry platform shape as the launch body.
      const { store } = makeStore()
      const provider = providerWith({ status: 'running' })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const { calls, fetchMock } = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryStop(store, provider)
      const stop = calls.find((call) => call.url === '/local-infer/stop')
      expect(JSON.parse(String(stop?.init?.body)).platform).toEqual({
        engineDirectory: '/eng/ninfer',
      })
    })

    it('ignores a stop from a failed launch', () => {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      // Drive the machine to a phase, then to failed.
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'failed' } })
      const { fetchMock } = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryStop(store, provider)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(state().launch['p1']?.status).toBe('failed')
    })

    it('settles to idle when the fast-poll confirms the provider is down', async () => {
      const { store, state } = makeStore()
      const provider = providerWith({ status: 'running' })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      const { fetchMock } = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
        // The fast-poll re-fetch reads the provider as stopped.
        '/local-infer/summary': () =>
          jsonAnswer(summaryWith([providerWith({ status: 'stopped' })])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryStop(store, provider)
      expect(state().launch['p1']?.status).toBe('stopping')
      // The first poll tick reads the running summary and re-fetches.
      await vi.advanceTimersByTimeAsync(STOP_POLL_MS)
      // Let the re-fetch settle the summary to the stopped provider.
      await flush(50)
      // The second poll tick reads the stopped summary and settles to idle.
      await vi.advanceTimersByTimeAsync(STOP_POLL_MS)
      expect(state().launch['p1']?.status).toBe('idle')
    })

    it('settles to failed at the stop deadline while the provider is still running', async () => {
      const { store, state } = makeStore()
      const provider = providerWith({ status: 'running' })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      const { fetchMock } = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
        // The fast-poll re-fetch keeps reading the provider as running.
        '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith({ status: 'running' })])),
      })
      vi.stubGlobal('fetch', fetchMock)
      performEntryStop(store, provider)
      await vi.advanceTimersByTimeAsync(STOP_HEALTH_DEADLINE_MS)
      expect(state().launch['p1']?.status).toBe('failed')
      expect(state().launch['p1']?.cause).toBe('stop')
    })

    it('cancel clears the poll and deadline, so a late tick never moves the machine', async () => {
      const { store, state } = makeStore()
      const provider = providerWith({ status: 'running' })
      store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      const { fetchMock } = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
        '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith({ status: 'running' })])),
      })
      vi.stubGlobal('fetch', fetchMock)
      const handle = performEntryStop(store, provider)
      expect(state().launch['p1']?.status).toBe('stopping')
      handle.cancel()
      await vi.advanceTimersByTimeAsync(STOP_HEALTH_DEADLINE_MS + STOP_POLL_MS)
      // The poll and deadline were cleared on cancel, so the machine stays
      // on stopping.
      expect(state().launch['p1']?.status).toBe('stopping')
    })
  })

  describe('performDraftLaunch', () => {
    // draftLaunchHarness builds the store performDraftLaunch reads (the
    // summary ack seeds the draft, so the form launches under the "draft"
    // abort key) plus the hand-driven launch stream it answers with.
    function draftLaunchHarness(provider: ProviderSummaryEntry) {
      const made = makeStore()
      made.store.dispatch({
        type: 'summary/ack',
        summary: summaryWith([provider]),
      })
      const stream = launchStream()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      return { ...made, stream, calls }
    }

    it('sends the draft autoRebuild value in the launch body', async () => {
      const provider = providerWith()
      const { store, stream, calls } = draftLaunchHarness(provider)
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'a-model' }, autoRebuild: true },
      })
      const run = performDraftLaunch(store, t)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await run
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).autoRebuild).toBe(true)
    })

    it('sends the draft platform entry directly, not an engine-keyed record', async () => {
      // draftLaunchBody pulls the draft's per-engine entry out of the
      // engine-keyed draft map and sends the entry itself: the shape the
      // host's parseStoredPlatformConfig reads.
      const provider = providerWith()
      const { store, stream, calls } = draftLaunchHarness(provider)
      store.dispatch({
        type: 'draft/edit',
        draft: {
          engine: 'ninfer',
          config: { model: 'a-model' },
          platform: {
            ninfer: { engineDirectory: '/draft/dir', engineFork: 'https://github.com/a/fork' },
          },
        },
      })
      const run = performDraftLaunch(store, t)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await run
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).platform).toEqual({
        engineDirectory: '/draft/dir',
        engineFork: 'https://github.com/a/fork',
      })
    })

    it('sends autoRebuild false when the draft carries no checkbox value', async () => {
      const provider = providerWith()
      // The harness seeds the draft through the summary ack: a null-draft
      // seed leaves the key absent, so the launch body carries false.
      const { store, stream, calls } = draftLaunchHarness(provider)
      expect('autoRebuild' in (store.getSnapshot().draft ?? {})).toBe(false)
      const run = performDraftLaunch(store, t)
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await run
      const launch = calls.find((call) => call.url === '/local-infer/launch')
      expect(JSON.parse(String(launch?.init?.body)).autoRebuild).toBe(false)
    })

    it('sets ui.sudoPending on a sudo event and clears it when the run settles healthy', async () => {
      const provider = providerWith()
      const { store, state, stream } = draftLaunchHarness(provider)
      const run = performDraftLaunch(store, t)
      stream.enqueue('{"sudo":true}')
      await flush()
      expect(state().ui.sudoPending).toBe(true)
      stream.enqueue('{"result":{"healthy":true,"plan":{"port":11435}}}')
      stream.close()
      await run
      // The run settled, so the draft control stops reading "Sudo needed".
      expect(state().ui.sudoPending).toBe(false)
      expect(state().actions.launch.status).toBe('ok')
    })

    it('clears ui.sudoPending when the run settles to a failure', async () => {
      const provider = providerWith()
      const { store, state, stream } = draftLaunchHarness(provider)
      const run = performDraftLaunch(store, t)
      stream.enqueue('{"sudo":true}')
      await flush()
      expect(state().ui.sudoPending).toBe(true)
      stream.enqueue('{"result":{"healthy":false,"detail":"no gpu"}}')
      stream.close()
      await run
      expect(state().ui.sudoPending).toBe(false)
      expect(state().actions.launch.status).toBe('error')
    })
  })
})
