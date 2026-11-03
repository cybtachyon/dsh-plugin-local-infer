import * as reactModule from 'react'
import type {
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LAUNCH_HEALTH_DEADLINE_MS } from '../src/machine/launch.ts'
import {
  EntryLaunchButton,
  NewProviderControl,
  ProviderList,
  ProviderRow,
} from '../src/render/ProviderList.tsx'
import { performEntryLaunch } from '../src/store/providers.ts'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
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
