import type { LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { downloadTemplate } from '../src/store/template.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'

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

// summaryWith builds the minimal summary the driver reads: the engine id,
// the config (the model directory source), and the chat-template status.
// The cast keeps the test free of the read model's full field set.
function summaryWith(config: Record<string, unknown>, chatTemplateStatus: unknown): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config,
    chatTemplateStatus,
  } as unknown as LocalInferSummary
}

// jsonFetch stubs the global fetch with a JSON answer and records the
// request, so the test reads the body the driver posts.
function jsonFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, fetchMock }
}

describe('the chat-template download driver (store/template.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('no-ops without a draft', async () => {
    const { store } = makeStore()
    const { fetchMock } = jsonFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, 'a-repo')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.getSnapshot().templateActions.download.status).toBe('idle')
  })

  it('no-ops for an empty repo', async () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith({ modelDirectory: '/models' }, null),
    })
    const { fetchMock } = jsonFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, '')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no-ops while a download is in flight', async () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith({ modelDirectory: '/models' }, null),
    })
    store.dispatch({ type: 'template/start' })
    const { fetchMock } = jsonFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, 'a-repo')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.getSnapshot().templateActions.download.status).toBe('pending')
  })

  it('posts the engine, the template, and the model directory', async () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith({ modelDirectory: '/models' }, null),
    })
    const { calls, fetchMock } = jsonFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, 'a-repo')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/local-infer/chat-template')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      engine: 'ninfer',
      template: 'a-repo',
      directory: '/models',
    })
    expect(store.getSnapshot().templateActions.download).toEqual({ status: 'ok', detail: 'ok' })
  })

  it('omits the directory key when the model directory is not a string', async () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith({ modelDirectory: 42 }, null),
    })
    const { calls, fetchMock } = jsonFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, 'a-repo')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.engine).toBe('ninfer')
    expect(body.template).toBe('a-repo')
    expect('directory' in body).toBe(false)
  })

  it('fails the cell with the route error message', async () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith({ modelDirectory: '/models' }, null),
    })
    const { fetchMock } = jsonFetch(500, { error: 'no such repo' })
    vi.stubGlobal('fetch', fetchMock)
    await downloadTemplate(store, 'a-repo')
    expect(store.getSnapshot().templateActions.download).toEqual({
      status: 'error',
      detail: 'no such repo',
    })
  })
})
