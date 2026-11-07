import * as react from 'react'
import { describe, expect, it } from 'vitest'
import {
  createCardStore,
  setReactModule,
  useCardStore,
  type CardStoreInstance,
} from '../src/store/useCardStore.ts'
import type { CardState } from '../src/store/types.ts'

// The store instance is non-React: dispatch reduces through the real reducer
// and notifies subscribers only on a snapshot identity change. The hook is
// tested by stubbing react's hook dispatcher, so no renderer is needed.

// The react internals the hook dispatcher stub plugs into. React 18's
// useRef and useSyncExternalStore are thin wrappers that delegate to
// ReactCurrentDispatcher.current, so a stub dispatcher drives the real hooks.
const dispatcherHolder = (
  react as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher

// withDispatcher runs fn with the given dispatcher installed as the active
// hook dispatcher, restoring the previous one on the way out.
function withDispatcher<T>(dispatcher: unknown, fn: () => T): T {
  const previous = dispatcherHolder.current
  dispatcherHolder.current = dispatcher
  try {
    return fn()
  } finally {
    dispatcherHolder.current = previous
  }
}

// makeDispatcher fakes the per-component hook slots: useRef returns a stable
// { current } per slot, and useSyncExternalStore returns the live snapshot.
// beginRender resets the slot index, modeling one render pass.
function makeDispatcher() {
  const refs: Array<{ current: unknown }> = []
  let slot = 0
  return {
    beginRender(): void {
      slot = 0
    },
    useRef(initial: unknown) {
      const index = slot++
      if (refs[index] === undefined) {
        refs[index] = { current: initial }
      }
      return refs[index]
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) {
      return getSnapshot()
    },
  }
}

describe('client store instance (store/useCardStore.ts)', () => {
  it('dispatch changes the snapshot and the state getter reads it live', () => {
    const store = createCardStore()
    const before = store.state
    expect(store.getSnapshot()).toBe(before)
    store.dispatch({ type: 'ui/patch', patch: { help: false } })
    const after = store.state
    expect(after).not.toBe(before)
    expect(after.ui.help).toBe(false)
    // The getter and getSnapshot agree on the live snapshot.
    expect(store.getSnapshot()).toBe(after)
  })

  it('keeps the snapshot identity stable between dispatches', () => {
    const store = createCardStore()
    const a = store.getSnapshot()
    expect(store.getSnapshot()).toBe(a)
    store.dispatch({ type: 'ui/patch', patch: { agentDefault: true } })
    expect(store.getSnapshot()).not.toBe(a)
  })

  it('notifies subscribers on a dispatch and not on a no-op dispatch', () => {
    const store = createCardStore()
    let calls = 0
    const unsubscribe = store.subscribe(() => {
      calls++
    })
    store.dispatch({ type: 'action/start', key: 'save' })
    store.dispatch({ type: 'action/timeout', key: 'save' })
    expect(calls).toBe(2)
    // A late ack after the timeout is a no-op: the reducer returns the same
    // state, so no subscriber is notified.
    store.dispatch({ type: 'action/ack', key: 'save', detail: 'late' })
    expect(calls).toBe(2)
    unsubscribe()
    store.dispatch({ type: 'ui/patch', patch: { help: false } })
    expect(calls).toBe(2)
  })

  it('lets multiple subscribers see the same state object identity', () => {
    const store = createCardStore()
    const seen: CardState[] = []
    const unsubscribeA = store.subscribe(() => {
      seen.push(store.getSnapshot())
    })
    const unsubscribeB = store.subscribe(() => {
      seen.push(store.getSnapshot())
    })
    store.dispatch({ type: 'ui/patch', patch: { help: false } })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    unsubscribeA()
    unsubscribeB()
  })

  it('survives a subscriber that unsubscribes during notification', () => {
    const store = createCardStore()
    let calls = 0
    // The listener runs synchronously inside dispatch, after the
    // subscription is assigned, so the const is initialized by then.
    const selfUnsub = store.subscribe(() => {
      calls++
      selfUnsub()
    })
    store.dispatch({ type: 'ui/patch', patch: { help: false } })
    expect(calls).toBe(1)
    // The self-unsubscribed listener is gone: a further dispatch is silent.
    store.dispatch({ type: 'ui/patch', patch: { help: true } })
    expect(calls).toBe(1)
  })
})

describe('client store hook (useCardStore)', () => {
  // This block runs in declaration order. The first case reads the store
  // module before setReactModule has wired react, so the not-wired throw is
  // exercised; the later cases wire the real react module once.
  it('throws before the bootstrap wires the react module', () => {
    const dispatcher = makeDispatcher()
    dispatcher.beginRender()
    expect(() => withDispatcher(dispatcher, () => useCardStore())).toThrow(
      /react module not wired/,
    )
  })

  it('creates a stable per-mount instance across renders', () => {
    setReactModule(react)
    const dispatcher = makeDispatcher()
    dispatcher.beginRender()
    const first = withDispatcher(dispatcher, () => useCardStore())
    dispatcher.beginRender()
    const second = withDispatcher(dispatcher, () => useCardStore())
    expect(second).toBe(first)
  })

  it('gives a fresh component a fresh instance', () => {
    setReactModule(react)
    const a = makeDispatcher()
    a.beginRender()
    const storeA = withDispatcher(a, () => useCardStore())
    const b = makeDispatcher()
    b.beginRender()
    const storeB = withDispatcher(b, () => useCardStore())
    expect(storeA).not.toBe(storeB)
  })

  it('exposes a live state that follows a dispatch', () => {
    setReactModule(react)
    const dispatcher = makeDispatcher()
    dispatcher.beginRender()
    const store: CardStoreInstance = withDispatcher(dispatcher, () => useCardStore())
    const before = store.state
    store.dispatch({ type: 'ui/patch', patch: { agentDefault: true } })
    expect(store.state).not.toBe(before)
    expect(store.state.ui.agentDefault).toBe(true)
  })
})
