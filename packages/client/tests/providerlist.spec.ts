import * as reactModule from 'react'
import type {
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  LAUNCH_HEALTH_DEADLINE_MS,
  LAUNCH_STATE_DISPLAY,
  type LaunchEvent,
  type LaunchInFlightStatus,
} from '../src/machine/launch.ts'
import {
  EntryLaunchButton,
  NewProviderControl,
  ProviderList,
  ProviderRow,
} from '../src/render/ProviderList.tsx'
import { clearInFlightRuns, trackGetAbort } from '../src/store/abort.ts'
import {
  performEntryLaunch,
  type EntryTimerHandle,
} from '../src/store/providers.ts'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
import { SUDO_STATE_LABEL_COLOR } from '../src/styles.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El
// children flattens the element's children (a single child, an array, or a
// nested JSX map array), dropping the null entries a conditional emits.
function children(e: El): El[] {
  const c = e.props.children
  if (c === undefined || c === null) {
    return []
  }
  const list = Array.isArray(c) ? c : [c]
  return list
    .flatMap((x): unknown => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]))
    .filter((x): x is unknown => x !== null && x !== undefined)
    .map(el)
}
// text reads the element tree's text content.
function text(e: El): string {
  const c = e.props.children
  if (c === undefined || c === null) {
    return ''
  }
  const list = Array.isArray(c) ? c : [c]
  return list
    .map((x) => (typeof x === 'object' && x !== null ? text(el(x)) : String(x ?? '')))
    .join('')
}
// buttons collects every native button element in the tree, in render order.
// A component element (a sub-component) is not a button, so it is skipped.
function buttons(node: unknown): El[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return []
  }
  const e = node as El
  const own = e.type === 'button' ? [e] : []
  return [...own, ...children(e).flatMap(buttons)]
}

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

// The react internals the hook dispatcher stub plugs into. React 18's hooks
// are thin wrappers that delegate to ReactCurrentDispatcher.current, so a
// stub dispatcher drives the shim's hook delegates.
const dispatcherHolder = (
  reactModule as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher

function withDispatcher<T>(dispatcher: unknown, fn: () => T): T {
  const previous = dispatcherHolder.current
  dispatcherHolder.current = dispatcher
  try {
    return fn()
  } finally {
    dispatcherHolder.current = previous
  }
}

// The dispatcher the row tests drive: it records the refs (the row's timer
// handle) and the unmount effect, so a test reads the handle and fires the
// cleanup.
function makeDispatcher() {
  const refs: Array<{ current: unknown }> = []
  let effect: (() => void | (() => void)) | null = null
  const dispatcher = {
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initialValue: unknown) => {
      const ref = { current: initialValue }
      refs.push(ref)
      return ref
    },
    useEffect: (effectFn: () => void | (() => void)) => {
      effect = effectFn
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return {
    dispatcher,
    getRef: (i: number) => refs[i],
    // Run the captured unmount effect and return its cleanup.
    runEffect: (): (() => void) | undefined =>
      effect !== null ? (effect() as () => void) : undefined,
  }
}

// launchStream builds a /local-infer/launch answer whose body streams NDJSON
// lines the test enqueues and closes by hand.
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

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the provider list (render/ProviderList.tsx)', () => {
  it('renders nothing while there are no entries', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([]) })
    expect(ProviderList({ store, t })).toBe(null)
  })

  it('composes a row per entry and the new-provider control after them', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith([providerWith(), providerWith({ id: 'p2' })]),
    })
    const root = el(ProviderList({ store, t }))
    expect(root.type).toBe('div')
    const [firstRow, secondRow, newControl] = children(root)
    expect(firstRow.type).toBe(ProviderRow)
    expect(secondRow.type).toBe(ProviderRow)
    expect(newControl.type).toBe(NewProviderControl)
  })
})

describe('the provider row (render/ProviderList.tsx ProviderRow)', () => {
  function renderRow(store: CardStore, patch: Partial<ProviderSummaryEntry> = {}) {
    const { dispatcher } = makeDispatcher()
    const provider = providerWith(patch)
    const row = withDispatcher(dispatcher, () =>
      el(
        ProviderRow({
          store,
          provider,
          t,
          engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
          editingId: null,
          deletingId: null,
        }),
      ),
    )
    return { row, dispatcher }
  }

  it('renders the dot, the title, and the Edit / Delete controls', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith([providerWith({ status: 'running' })]),
    })
    const { row } = renderRow(store, { status: 'running' })
    expect(row.type).toBe('div')
    const rowButtons = buttons(row)
    // The row's native buttons are Edit and Delete; the Launch control is a
    // sub-component (EntryLaunchButton), not a native button.
    expect(rowButtons).toHaveLength(2)
    expect(text(rowButtons[0])).toBe(t.edit)
    expect(text(rowButtons[1])).toBe(t.delete)
    // The title reads the engine label, the model, and the status.
    const title = children(row).find((c) => c.type === 'span' && c.props['aria-label'])
    expect(title?.props['aria-label']).toBe('NInfer: a-model (' + t.statusRunning + ')')
  })

  it('shows the ongoing spinner and the live readout while a Get run is in flight', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith([providerWith({ status: 'stopped' })]),
    })
    try {
      // A Get run in flight for the provider being edited: the in-flight
      // registry reads true, and the progress state has landed.
      trackGetAbort(new AbortController())
      store.dispatch({
        type: 'ui/patch',
        patch: {
          editingProviderId: 'p1',
          getProgress: {
            step: 'Downloading x.safetensors',
            percent: 42,
            doneBytes: 43.2e9,
            totalBytes: 102.4e9,
            etaSeconds: 751,
            unit: 'bytes',
          },
        },
      })
      const { dispatcher } = makeDispatcher()
      const provider = providerWith({ status: 'stopped' })
      const row = withDispatcher(dispatcher, () =>
        el(
          ProviderRow({
            store,
            provider,
            t,
            engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
            editingId: 'p1',
            deletingId: null,
          }),
        ),
      )
      // The title reads the getting status and the live download readout.
      const title = children(row).find((c) => c.type === 'span' && c.props['aria-label'])
      expect(title?.props['aria-label']).toBe(
        'NInfer: a-model (' + t.gettingReadout + ') · Downloading… 42% · 43.2/102.4 GB · ETA 12:31',
      )
      // The status dot is the ongoing spinner, not the status-mapped dot.
      const dot = children(row)[0]
      expect(dot.type).toBe('span')
      expect(dot.props['aria-hidden']).toBe('true')
      expect(text(dot)).toBe('…')
    } finally {
      clearInFlightRuns()
    }
  })

  it('keeps the status dot and title unchanged when no Get run is in flight', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith([providerWith({ status: 'stopped' })]),
    })
    const { dispatcher } = makeDispatcher()
    const provider = providerWith({ status: 'stopped' })
    const row = withDispatcher(dispatcher, () =>
      el(
        ProviderRow({
          store,
          provider,
          t,
          engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
          editingId: 'p1',
          deletingId: null,
        }),
      )
    )
    // No Get in flight: the title reads the status, and the dot is the
    // status-mapped dot (stopped is the error glyph).
    const title = children(row).find((c) => c.type === 'span' && c.props['aria-label'])
    expect(title?.props['aria-label']).toBe('NInfer: a-model (' + t.statusStopped + ')')
    const dot = children(row)[0]
    expect(text(dot)).toBe('✗')
  })

  it('renders the fork owner/repo as the title when the entry names a fork', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    const { row } = renderRow(store, {
      platform: { engineFork: 'https://github.com/Ninfer/ninfer-all' },
    })
    const title = children(row).find((c) => c.type === 'span' && c.props['aria-label'])
    expect(title?.props['aria-label']).toContain('Ninfer/ninfer-all')
  })

  it('shows the Cancel control on the entry being edited', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    const { dispatcher } = makeDispatcher()
    const provider = providerWith()
    const row = withDispatcher(dispatcher, () =>
      el(
        ProviderRow({
          store,
          provider,
          t,
          engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
          editingId: 'p1',
          deletingId: null,
        }),
      ),
    )
    const rowButtons = buttons(row)
    expect(text(rowButtons[0])).toBe(t.cancel)
  })

  it('disables the Delete control while a delete is in flight', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    const { dispatcher } = makeDispatcher()
    const provider = providerWith()
    const row = withDispatcher(dispatcher, () =>
      el(
        ProviderRow({
          store,
          provider,
          t,
          engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
          editingId: null,
          deletingId: 'p1',
        }),
      ),
    )
    const rowButtons = buttons(row)
    expect(el(rowButtons[1]).props.disabled).toBe(true)
  })
})

describe('the new-provider control (render/ProviderList.tsx NewProviderControl)', () => {
  it('reads as a button while a new provider can start', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    const control = el(NewProviderControl({ store, t }))
    expect(control.type).toBe('button')
    expect(text(control)).toBe(t.newProvider)
  })

  it('reads as plain text while the form is in new-provider mode', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    store.dispatch({ type: 'ui/patch', patch: { providerFormMode: 'new' } })
    const control = el(NewProviderControl({ store, t }))
    expect(control.type).toBe('span')
    expect(text(control)).toBe(t.newProvider)
  })
})

describe('the per-entry Launch control (render/ProviderList.tsx EntryLaunchButton)', () => {
  function renderEntry(store: CardStore, patch: Partial<ProviderSummaryEntry> = {}) {
    const provider = providerWith(patch)
    return el(
      EntryLaunchButton({
        store,
        provider,
        t,
        handleRef: { current: null },
      }),
    )
  }

  it('reads as a Launch button at idle', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    expect(text(renderEntry(store))).toBe(t.entryLaunch)
  })

  it('reads as a Stop button while the provider is running', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'summary/ack',
      summary: summaryWith([providerWith({ status: 'running' })]),
    })
    expect(text(renderEntry(store, { status: 'running' }))).toBe(t.entryStop)
  })

  it('reads as a red Logs button on a failed launch', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'failed' } })
    const logs = renderEntry(store)
    expect(text(logs)).toBe(t.entryLogs)
    expect(el(logs).props['aria-label']).toBe(t.entryLogs)
  })

  it('reads as a disabled throbber with the phase label while a rebuild is in flight', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    store.dispatch({
      type: 'launch/move',
      providerId: 'p1',
      event: { type: 'step', step: 'build' },
    })
    const throbber = renderEntry(store)
    expect(el(throbber).props.disabled).toBe(true)
    expect(el(throbber).props['aria-label']).toBe(t.entryBuilding)
  })

  it('reads as a disabled throbber with the stopping label while a stop is in flight', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'stop' } })
    const throbber = renderEntry(store)
    expect(el(throbber).props.disabled).toBe(true)
    expect(el(throbber).props['aria-label']).toBe(t.stopping)
  })

  it('reads as a disabled throbber with the downloading label while the engine fetches files', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    // Drive the machine to a phase, then to downloading (a no-op from idle).
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'downloading' } })
    const throbber = renderEntry(store)
    expect(el(throbber).props.disabled).toBe(true)
    expect(el(throbber).props['aria-label']).toBe(t.entryDownloading)
  })

  it('reads as a Sudo needed throbber painted with the warning color at the sudo status', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'sudoNeeded' } })
    // The sudo throbber is wrapped in the warning-token span; the button
    // inside keeps the busy throbber contract (disabled, the label carries).
    const wrapped = renderEntry(store)
    expect(el(wrapped).type).toBe('span')
    expect((el(wrapped).props.style as Record<string, unknown>).color).toBe(
      SUDO_STATE_LABEL_COLOR,
    )
    const throbber = buttons(wrapped)[0]
    expect(el(throbber).props.disabled).toBe(true)
    expect(el(throbber).props['aria-label']).toBe(t.entrySudo)
    expect(text(wrapped)).toBe(t.entrySudo)
  })

  // One event path per in-flight state so the machine (not a hand-set
  // entry) drives the control, and the expected label reads through the
  // machine's LAUNCH_STATE_DISPLAY mapping: the entry button can only
  // reach a phase label through phaseLabelFor, so this is the render-side
  // completeness check for the displayText mapping.
  const THROBBER_PATHS: Record<LaunchInFlightStatus, LaunchEvent[]> = {
    prereqs: [{ type: 'start' }],
    download: [{ type: 'start' }, { type: 'step', step: 'download' }],
    downloading: [{ type: 'start' }, { type: 'downloading' }],
    build: [{ type: 'start' }, { type: 'step', step: 'build' }],
    launch: [{ type: 'start' }, { type: 'step', step: 'launch' }],
    sudo: [{ type: 'start' }, { type: 'sudoNeeded' }],
    stopping: [{ type: 'stop' }],
  }
  for (const [status, events] of Object.entries(THROBBER_PATHS) as Array<
    [LaunchInFlightStatus, LaunchEvent[]]
  >) {
    it(`throbbers the ${status} state with its mapped label`, () => {
      const { store } = makeStore()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([providerWith()]) })
      for (const event of events) {
        store.dispatch({ type: 'launch/move', providerId: 'p1', event })
      }
      expect(store.getSnapshot().launch['p1']?.status).toBe(status)
      // The sudo throbber is wrapped in the warning span; buttons() reads
      // the busy button through the wrapper either way.
      const throbber = el(buttons(renderEntry(store))[0])
      expect(throbber.props.disabled).toBe(true)
      expect(throbber.props['aria-label']).toBe(t[LAUNCH_STATE_DISPLAY[status]])
    })
  }
})

describe('the provider list control handlers (render/ProviderList.tsx)', () => {
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

  async function flush(times = 30): Promise<void> {
    for (let i = 0; i < times; i++) {
      await Promise.resolve()
    }
  }

  it('the Edit button loads the provider into the form', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      const fetchMock = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { dispatcher } = makeDispatcher()
      const row = withDispatcher(dispatcher, () =>
        el(
          ProviderRow({
            store,
            provider,
            t,
            engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
            editingId: null,
            deletingId: null,
          }),
        ),
      )
      const [editButton] = buttons(row)
      ;(editButton.props.onClick as () => void)()
      await flush()
      expect(state().ui.editingProviderId).toBe('p1')
      expect(state().ui.providerFormMode).toBe('editing')
      expect(state().draft?.config).toEqual({ model: 'a-model' })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the Cancel button collapses the editing form and reverts the draft', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      store.dispatch({
        type: 'ui/patch',
        patch: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      store.dispatch({
        type: 'draft/edit',
        draft: { engine: 'ninfer', config: { model: 'staged' } },
      })
      const fetchMock = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { dispatcher } = makeDispatcher()
      const row = withDispatcher(dispatcher, () =>
        el(
          ProviderRow({
            store,
            provider,
            t,
            engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
            editingId: 'p1',
            deletingId: null,
          }),
        ),
      )
      const [cancelButton] = buttons(row)
      expect(text(cancelButton)).toBe(t.cancel)
      ;(cancelButton.props.onClick as () => void)()
      await flush()
      expect(state().ui.editingProviderId).toBeNull()
      expect(state().dirty).toBe(false)
      expect(state().draft?.config).toEqual({ model: 'a-model' })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the Delete button removes the entry through the provider-delete route', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      const { calls, fetchMock } = routeFetch({
        '/local-infer/provider-delete': () => jsonAnswer(summaryWith([])),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { dispatcher } = makeDispatcher()
      const row = withDispatcher(dispatcher, () =>
        el(
          ProviderRow({
            store,
            provider,
            t,
            engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
            editingId: null,
            deletingId: null,
          }),
        ),
      )
      const [, deleteButton] = buttons(row)
      ;(deleteButton.props.onClick as () => void)()
      await flush()
      expect(calls.some((c) => c.url === '/local-infer/provider-delete')).toBe(true)
      expect(state().summary?.providers).toEqual([])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the new-provider control starts a fresh provider', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      const fetchMock = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const control = el(NewProviderControl({ store, t }))
      ;(control.props.onClick as () => void)()
      await flush()
      expect(state().ui.providerFormMode).toBe('new')
      expect(state().draft?.config).toEqual({})
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the entry Launch button starts the entry launch machine', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      const stream = launchStream()
      const fetchMock = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
      })
      vi.stubGlobal('fetch', fetchMock)
      const handleRef: { current: EntryTimerHandle | null } = { current: null }
      const launch = el(
        EntryLaunchButton({ store, provider, t, handleRef }),
      )
      ;(launch.props.onClick as () => void)()
      // The click armed the entry's timer handle and started the machine at
      // the prereqs phase (the start event).
      expect(handleRef.current).not.toBe(null)
      expect(state().launch['p1']?.status).toBe('prereqs')
      handleRef.current?.cancel()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the entry Stop button moves the machine to stopping', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith({ status: 'running' })
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      // The launch machine stays idle (no phase), so the running provider
      // status reads as the Stop control, not a rebuild throbber.
      const fetchMock = routeFetch({
        '/local-infer/stop': () => jsonAnswer({ stopped: true }),
        '/local-infer/summary': () => jsonAnswer(summaryWith([providerWith({ status: 'stopped' })])),
      })
      vi.stubGlobal('fetch', fetchMock)
      const handleRef: { current: EntryTimerHandle | null } = { current: null }
      const stop = el(EntryLaunchButton({ store, provider, t, handleRef }))
      ;(stop.props.onClick as () => void)()
      expect(state().launch['p1']?.status).toBe('stopping')
      handleRef.current?.cancel()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the entry Logs button opens the entry for editing and resets the machine', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
      store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'failed' } })
      const fetchMock = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summaryWith([provider])),
        '/local-infer/deps': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const handleRef: { current: EntryTimerHandle | null } = { current: null }
      const logs = el(EntryLaunchButton({ store, provider, t, handleRef }))
      ;(logs.props.onClick as () => void)()
      await flush()
      expect(state().ui.editingProviderId).toBe('p1')
      expect(state().launch['p1']?.status).toBe('idle')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('the fork title short name (render/ProviderList.tsx repoShortName)', () => {
  function titleFor(fork: unknown): string {
    const { store } = makeStore()
    const provider = providerWith({ platform: { engineFork: fork } as never })
    store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
    const { dispatcher } = makeDispatcher()
    const row = withDispatcher(dispatcher, () =>
      el(
        ProviderRow({
          store,
          provider,
          t,
          engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
          editingId: null,
          deletingId: null,
        }),
      ),
    )
    const title = children(row).find((c) => c.type === 'span' && c.props['aria-label'])
    return String(title?.props['aria-label'] ?? '')
  }

  it('reads a protocol URL as its owner/repo', () => {
    expect(titleFor('https://github.com/Ninfer/ninfer-all')).toContain('Ninfer/ninfer-all')
  })

  it('reads an scp-style reference as its owner/repo', () => {
    expect(titleFor('git@github.com:Ninfer/ninfer-all')).toContain('Ninfer/ninfer-all')
  })

  it('strips a trailing .git from the repo name', () => {
    expect(titleFor('https://github.com/Ninfer/ninfer-all.git')).toContain('Ninfer/ninfer-all')
  })

  it('reads a bare string as its repo name (no owner)', () => {
    // A bare string with no slash reads as the repo name alone.
    expect(titleFor('ninfer')).toBe('ninfer: a-model (' + t.statusStopped + ')')
  })

  it('falls back to the engine label for a non-string fork', () => {
    expect(titleFor(undefined)).toBe('NInfer: a-model (' + t.statusStopped + ')')
  })
})

describe('the per-entry timer unmount cleanup (render/ProviderList.tsx ProviderRow)', () => {
  it('cancel on unmount clears the launch deadline, so a late tick never moves the machine', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = makeStore()
      const provider = providerWith()
      store.dispatch({ type: 'summary/ack', summary: summaryWith([provider]) })
      const stream = launchStream()
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/local-infer/launch') {
          return stream.response()
        }
        return new Response(JSON.stringify(summaryWith([provider])), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const { dispatcher, getRef, runEffect } = makeDispatcher()
      const row = withDispatcher(dispatcher, () =>
        el(
          ProviderRow({
            store,
            provider,
            t,
            engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
            editingId: null,
            deletingId: null,
          }),
        ),
      )
      // The row renders the Launch control as an EntryLaunchButton
      // sub-component.
      const launchControl = children(row).find((c) => c.type === EntryLaunchButton)
      expect(launchControl).toBeDefined()
      // Click the Launch control: it arms the entry's timer handle on the
      // row's ref, the same assignment the control's onClick performs.
      const handleRef = getRef(0) as { current: { cancel(): void } | null }
      handleRef.current = performEntryLaunch(store, provider, t)
      expect(handleRef.current).not.toBe(null)
      // The launch step arms the health-poll deadline.
      stream.enqueue('{"step":"launch"}')
      await flush()
      expect(state().launch['p1']?.status).toBe('launch')
      // Unmount: run the effect's cleanup, which cancels the handle.
      const cleanup = runEffect()
      cleanup?.()
      await vi.advanceTimersByTimeAsync(LAUNCH_HEALTH_DEADLINE_MS)
      // The deadline was cleared, so the machine stays on the phase.
      expect(state().launch['p1']?.status).toBe('launch')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
