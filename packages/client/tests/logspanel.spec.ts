import * as reactModule from 'react'
import type { LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it } from 'vitest'
import { LogsPanel } from '../src/render/LogsPanel.tsx'
import { setPrimitivesModule } from '../src/render/primitives.tsx'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { TEXT } from '../src/text.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El
// children flattens the element's children (a single child, an array, or an
// array carrying a nested JSX map array), dropping the null entries a JSX
// conditional branch ({cond ? el : null}) emits into the array.
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

// makeStore builds a test store over the real reducer, the way the card's
// per-mount store does.
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

// summaryWith builds the minimal summary the panel reads: the engine id, the
// config, and the persisted last-run logs the pane shows while no run is in
// flight.
function summaryWith(lastLogs: string = ''): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config: { model: 'a-model' },
    lastLogs,
  } as unknown as LocalInferSummary
}

// The textarea element surface the effect and the scroll handler read: the
// live scroll metrics.
interface FakeTextarea {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
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

// makeDispatcher stubs the hooks LogsPanel drives: two refs (the textarea
// element, the in-flight drag) created once per instance in call order, and
// the auto-scroll effect the tests run by hand. beginRender mirrors React's
// per-render hook-call order, so a re-render reuses the first render's refs.
function makeDispatcher() {
  const refs: Array<{ current: unknown }> = []
  let callIndex = 0
  let effect: (() => void) | null = null
  const dispatcher = {
    useRef: (initialValue: unknown) => {
      if (callIndex >= refs.length) {
        refs.push({ current: initialValue })
      }
      const ref = refs[callIndex]
      callIndex += 1
      return ref
    },
    useEffect: (fn: () => void) => {
      effect = fn
    },
    useState: (initial: unknown) => [initial, () => {}],
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return {
    dispatcher,
    beginRender: () => {
      callIndex = 0
    },
    textareaRef: () => refs[0] as { current: FakeTextarea | null },
    dragRef: () => refs[1] as { current: { startClientY: number; startHeight: number } | null },
    runEffect: () => {
      effect?.()
    },
  }
}

// withWindow stubs the global window the resize drag binds its pointermove
// and pointerup listeners to, and hands the test a fire helper.
function withWindow(fn: (fire: (type: string, event: unknown) => void) => void): void {
  const listeners: Record<string, Array<(event: unknown) => void>> = {}
  const windowStub = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      ;(listeners[type] ??= []).push(handler)
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler)
    },
  }
  const fire = (type: string, event: unknown): void => {
    for (const handler of listeners[type] ?? []) {
      handler(event)
    }
  }
  const globals = globalThis as Record<string, unknown>
  const previous = globals.window
  globals.window = windowStub
  try {
    fn(fire)
  } finally {
    if (previous === undefined) {
      delete globals.window
    } else {
      globals.window = previous
    }
  }
}

// render drives one LogsPanel render through the stub dispatcher.
function render(d: ReturnType<typeof makeDispatcher>, store: CardStore, t: typeof TEXT.en): El {
  d.beginRender()
  return withDispatcher(d.dispatcher, () => el(LogsPanel({ store, t })))
}

// sectionParts pulls the panel's parts out of the rendered tree: the textarea,
// the chevron handle, and the log-location input.
function sectionParts(root: El) {
  const [label, relative, row] = children(root)
  const [textarea, chevron] = children(relative)
  const [, input] = children(row)
  return { label, textarea, chevron, input }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the Logs section (render/LogsPanel.tsx)', () => {
  const t = TEXT.en

  it('renders the label, the textarea, the chevron fallback, and the log-location input', () => {
    const { store } = makeStore()
    const d = makeDispatcher()
    const root = render(d, store, t)
    expect(root.type).toBe('div')
    const { label, textarea, chevron, input } = sectionParts(root)
    expect(text(label)).toBe(t.logs)
    expect(textarea.type).toBe('textarea')
    expect(textarea.props.value).toBe('')
    expect(textarea.props.readOnly).toBe(true)
    expect(textarea.props['aria-label']).toBe(t.logs)
    const style = textarea.props.style as Record<string, unknown>
    expect(style.height).toBe(96)
    expect(style.resize).toBe('none')
    // The chevron handle: the native corner glyph a host without the seed
    // keeps, the resize affordance, and the drag handler.
    expect(text(chevron)).toBe('\u231F')
    expect(chevron.props.role).toBe('button')
    expect(chevron.props['aria-label']).toBe(t.logs + ' ' + t.resize)
    expect(typeof chevron.props.onPointerDown).toBe('function')
    // The log-location field edits the ui preference.
    expect(text(input)).toBe('')
    expect(typeof input.props.onChange).toBe('function')
  })

  it('shows the summary lastLogs while no run is in flight', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith('line one\nline two') })
    const d = makeDispatcher()
    const root = render(d, store, t)
    expect(sectionParts(root).textarea.props.value).toBe('line one\nline two')
  })

  it('shows the streamed Get buffer over the persisted logs while a run is in flight', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith('persisted') })
    store.dispatch({
      type: 'ui/patch',
      patch: { logs: { ...store.getSnapshot().ui.logs, getLogs: 'streamed chunk' } },
    })
    const d = makeDispatcher()
    const root = render(d, store, t)
    expect(sectionParts(root).textarea.props.value).toBe('streamed chunk')
  })

  it('parks the scroll mode at manual when the user scrolls up, and re-arms it at the bottom', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    const elTree = render(d, store, t)
    const fake = { scrollTop: 0, scrollHeight: 500, clientHeight: 96 }
    d.textareaRef().current = fake
    // A scroll away from the bottom parks the mode at manual.
    ;(sectionParts(elTree).textarea.props.onScroll as () => void)()
    expect(state().ui.logs.scrollMode).toBe('manual')
    // A scroll to the very bottom (within the 4px tolerance) re-arms it.
    fake.scrollTop = 400
    const reRendered = render(d, store, t)
    ;(sectionParts(reRendered).textarea.props.onScroll as () => void)()
    expect(state().ui.logs.scrollMode).toBe('scrolling')
  })

  it('treats a scroll 1px short of the bottom as manual', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    const elTree = render(d, store, t)
    const fake = { scrollTop: 399, scrollHeight: 500, clientHeight: 96 }
    d.textareaRef().current = fake
    ;(sectionParts(elTree).textarea.props.onScroll as () => void)()
    expect(state().ui.logs.scrollMode).toBe('manual')
  })

  it('pins the view to the bottom in fresh mode and arms scrolling', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    render(d, store, t)
    const fake = { scrollTop: 0, scrollHeight: 500, clientHeight: 96 }
    d.textareaRef().current = fake
    d.runEffect()
    expect(fake.scrollTop).toBe(500)
    expect(state().ui.logs.scrollMode).toBe('scrolling')
  })

  it('pins the view to the bottom in scrolling mode without dispatching', () => {
    const { store, state } = makeStore()
    store.dispatch({ type: 'ui/patch', patch: { logs: { ...state().ui.logs, scrollMode: 'scrolling' } } })
    const d = makeDispatcher()
    render(d, store, t)
    const fake = { scrollTop: 0, scrollHeight: 500, clientHeight: 96 }
    d.textareaRef().current = fake
    d.runEffect()
    expect(fake.scrollTop).toBe(500)
    expect(state().ui.logs.scrollMode).toBe('scrolling')
  })

  it('leaves the view where the user put it in manual mode', () => {
    const { store, state } = makeStore()
    store.dispatch({ type: 'ui/patch', patch: { logs: { ...state().ui.logs, scrollMode: 'manual' } } })
    const d = makeDispatcher()
    render(d, store, t)
    const fake = { scrollTop: 40, scrollHeight: 500, clientHeight: 96 }
    d.textareaRef().current = fake
    d.runEffect()
    expect(fake.scrollTop).toBe(40)
  })

  it('does not pin the view while the textarea is not mounted', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    render(d, store, t)
    d.runEffect()
    expect(state().ui.logs.scrollMode).toBe('fresh')
  })

  it('drags the chevron to resize the pane, clamped to the 96-480 px range', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    const elTree = render(d, store, t)
    const start = sectionParts(elTree).chevron.props.onPointerDown as (event: {
      clientY: number
      preventDefault(): void
    }) => void
    withWindow((fire) => {
      start({ clientY: 100, preventDefault: () => {} })
      // Drag down 40px: 96 + 40.
      fire('pointermove', { clientY: 140, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(136)
      // Drag past the top of the range: clamps to 480.
      fire('pointermove', { clientY: 1000, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(480)
      // Drag up past the floor: clamps to 96.
      fire('pointermove', { clientY: 0, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(96)
      // Pointer up ends the drag: a later move is a no-op.
      fire('pointerup', {})
      fire('pointermove', { clientY: 300, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(96)
    })
  })

  it('keeps the drag base stable across a re-render mid-drag', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    const elTree = render(d, store, t)
    const start = sectionParts(elTree).chevron.props.onPointerDown as (event: {
      clientY: number
      preventDefault(): void
    }) => void
    withWindow((fire) => {
      start({ clientY: 100, preventDefault: () => {} })
      fire('pointermove', { clientY: 140, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(136)
      // A content update re-renders the panel mid-drag; the drag base (the
      // pointer's starting Y and the height it started from) survives, so the
      // next move prices from the original base, not the new height.
      const reRendered = render(d, store, t)
      expect(reRendered).toBeTruthy()
      fire('pointermove', { clientY: 160, preventDefault: () => {} })
      expect(state().ui.logs.height).toBe(156)
    })
  })

  it('edits the log-location field through the ui patch', () => {
    const { store, state } = makeStore()
    const d = makeDispatcher()
    const root = render(d, store, t)
    const input = sectionParts(root).input
    ;(input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '/var/log/engine.log' },
    })
    expect(state().ui.logPath).toBe('/var/log/engine.log')
  })

  it('draws the primitives chevron when the host seeds it', () => {
    const ChevronMarker = () => null
    setPrimitivesModule({ IconChevronDownOutlineRegular: ChevronMarker })
    try {
      const { store } = makeStore()
      const d = makeDispatcher()
      const root = render(d, store, t)
      const chevron = sectionParts(root).chevron
      // The seed's icon wrapped in the -45 degree rotation span, not the
      // native glyph.
      expect(text(chevron)).toBe('')
      const [span] = children(chevron)
      const spanStyle = span.props.style as Record<string, unknown>
      expect(spanStyle.transform).toBe('rotate(-45deg)')
      expect(el(children(span)[0]).type).toBe(ChevronMarker)
    } finally {
      setPrimitivesModule(null)
    }
  })
})
