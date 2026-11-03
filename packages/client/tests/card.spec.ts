import * as reactModule from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { card } from '../src/Card.tsx'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props?: Record<string, unknown> }
// text reads the element tree's text content, flattening strings, numbers,
// and nested element arrays.
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node !== 'object') {
    return String(node ?? '')
  }
  const e = node as El
  const c = e.props?.children
  if (c === undefined || c === null) {
    return ''
  }
  const list = Array.isArray(c) ? c : [c]
  return list.map((x) => text(x)).join('')
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

// The dispatcher the card tests drive: it records the refs (the store ref,
// the draft ref, the re-price timer) and the effects, so a test reads the
// store and fires the unmount cleanup.
function makeDispatcher() {
  const refs: Array<{ current: unknown }> = []
  const effects: Array<() => void | (() => void)> = []
  let refCallIndex = 0
  const dispatcher = {
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initialValue: unknown) => {
      const index = refCallIndex
      refCallIndex += 1
      if (refs[index] === undefined) {
        refs[index] = { current: initialValue }
      }
      return refs[index]
    },
    useEffect: (effectFn: () => void | (() => void)) => {
      effects.push(effectFn)
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return {
    dispatcher,
    getRef: (i: number) => refs[i],
    runEffects: () => {
      for (const effect of effects) {
        effect()
      }
    },
    // Reset the ref call index between renders (the hooks run in the same
    // order, so the same index maps to the same ref).
    resetForRerender: () => {
      refCallIndex = 0
    },
  }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the card composer (src/Card.tsx)', () => {
  it('the card factory returns a component', () => {
    const Component = card(null, { current: "en" }, null)
    expect(typeof Component).toBe('function')
  })

  it('renders the loading state while there is no summary and no draft', () => {
    const Component = card(null, { current: "en" }, null)
    const { dispatcher, runEffects } = makeDispatcher()
    const rendered = withDispatcher(dispatcher, () => Component())
    runEffects()
    expect(typeof rendered).toBe('object')
    expect(text(rendered)).toBe(t.loading)
  })

  it('renders the card frame with a summary and a draft', () => {
    const Component = card(null, { current: "en" }, null)
    const { dispatcher, getRef, runEffects, resetForRerender } = makeDispatcher()
    withDispatcher(dispatcher, () => {
      Component()
    })
    runEffects()
    // The store ref is the first useRef the card (and useCardStore) records.
    // Seed it with a summary and a draft, then re-render.
    const storeRef = getRef(0)
    const store = storeRef.current as {
      dispatch: (action: unknown) => void
    }
    expect(store).not.toBe(null)
    store.dispatch({
      type: 'summary/ack',
      summary: {
        engineId: 'ninfer',
        config: { model: 'a-model' },
        providers: [],
        engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
        formModel: { sections: [] },
        meterModel: { source: 'not-measured', segments: [], unknownEngines: null },
        verdict: null,
        warningsModel: { banner: { visible: false, level: null, count: 0, warnings: [] }, inline: {} },
      },
    })
    store.dispatch({
      type: 'draft/load',
      draft: { engine: 'ninfer', config: { model: 'a-model' }, platform: {} },
    })
    resetForRerender()
    const rendered = withDispatcher(dispatcher, () => Component())
    expect(typeof rendered).toBe('object')
    // The card frame renders the section title.
    expect(text(rendered)).toContain(t.section)
  })
})
