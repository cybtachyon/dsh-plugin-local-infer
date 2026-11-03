/**
 * The per-mount card store instance and the React binding over it.
 *
 * createCardStore builds the one store instance a card mount owns: the
 * CardState snapshot, dispatch (the only mutator, through cardReducer),
 * subscribe (the useSyncExternalStore notification seam), and getSnapshot.
 * useCardStore binds that instance to a component through
 * react.useSyncExternalStore, so a dispatch re-renders every component bound
 * to the store and store.state reads the fresh snapshot.
 *
 * The store module stays free of a runtime require: the bootstrap
 * (plugin.ts) resolves react from the shell's frozen platform module table
 * and hands it in through setReactModule, so the bundle keeps its two
 * runtime require calls in the bootstrap and a host without react skips the
 * card there, not at module load.
 * @module dsh-plugin-local-infer/client/store/useCardStore
 */

import { cardReducer } from './reducer.ts'
import {
  initialCardState,
  type CardAction,
  type CardState,
} from './types.ts'

/**
 * ReactLike is the react surface the card calls. The full react type is a
 * runtime external, not a compile dependency, so the card names only what it
 * calls: the classic transform's createElement and Fragment, the hooks the
 * components and the store binding use.
 */
export interface ReactLike {
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown
  Fragment: unknown
  useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void]
  useRef<T>(initialValue: T): { current: T }
  useEffect(effect: () => (void | (() => void)), deps?: unknown[]): void
  useSyncExternalStore<Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ): Snapshot
}

/**
 * CardStoreInstance is the per-mount store instance: the live state read,
 * dispatch, the subscribe seam, and getSnapshot. It structurally satisfies
 * the CardStore interface in store/sync.ts (dispatch + getSnapshot), so
 * performAction drives it directly.
 */
export interface CardStoreInstance {
  /** The current snapshot, read live; a dispatch replaces it. */
  readonly state: CardState
  dispatch(action: CardAction): void
  subscribe(listener: () => void): () => void
  getSnapshot(): CardState
}

// reactModuleRef holds the bootstrap's resolved react module. It stays null
// until setReactModule runs, so a hook called before the bootstrap wired it
// fails loudly instead of reading a stale module.
let reactModuleRef: ReactLike | null = null

/**
 * setReactModule hands the bootstrap's resolved react module to the store
 * binding. mountCard calls it after its require('react') succeeds, so the
 * hook reads the same frozen-table module the card renders with.
 */
export function setReactModule(react: ReactLike): void {
  reactModuleRef = react
}

/**
 * getReactModule returns the bootstrap's resolved react module. It throws if
 * setReactModule has not run, so a render before the bootstrap wired react
 * fails loudly (the same contract the hook has).
 */
export function getReactModule(): ReactLike {
  if (reactModuleRef === null) {
    throw new Error('react module not wired; call setReactModule first')
  }
  return reactModuleRef
}

/**
 * createCardStore builds one per-mount store instance. dispatch reduces the
 * action over the current snapshot through cardReducer and notifies
 * subscribers only when the snapshot identity changes, so a no-op dispatch
 * (a late ack after the deadline) never re-renders a bound component.
 */
export function createCardStore(): CardStoreInstance {
  let state: CardState = initialCardState()
  const listeners = new Set<() => void>()
  return {
    get state() {
      return state
    },
    dispatch(action: CardAction) {
      const next = cardReducer(state, action)
      if (next === state) {
        return
      }
      state = next
      for (const listener of Array.from(listeners)) {
        listener()
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return state
    },
  }
}

/**
 * useCardStore binds the per-mount store instance to a component. The
 * instance is created once per mount (useRef) and shared by every render of
 * that component; the useSyncExternalStore call subscribes the component, so
 * a dispatch re-renders it and store.state reads the fresh snapshot. Child
 * components take the instance as a prop; only the owner calls the hook.
 */
export function useCardStore(): CardStoreInstance {
  // The card renders only after mountCard wired react, so a throw here is a
  // hook called outside the card (a test, or a mis-wired mount).
  const react = getReactModule()
  const storeRef = react.useRef<CardStoreInstance | null>(null)
  let store = storeRef.current
  if (store === null) {
    store = createCardStore()
    storeRef.current = store
  }
  react.useSyncExternalStore(store.subscribe, store.getSnapshot)
  return store
}
