/**
 * The module-scope `react` the classic JSX transform targets.
 *
 * The bundle keeps its require('react') in the bootstrap (mountCard in
 * plugin.ts), not at module load: a host without react skips the card there.
 * The TSX files import this shim instead of `react` directly. The shim is a
 * stable object whose members delegate to the module wired by
 * setReactModule, so the JSX factory (react.createElement) and fragment
 * (react.Fragment) resolve through the frozen-table module at render time,
 * and a render before the bootstrap wired react fails loudly.
 * @module dsh-plugin-local-infer/client/render/react
 */

import { getReactModule, type ReactLike } from '../store/useCardStore.ts'

/** The react surface the card's TSX renders with (the ReactLike contract). */
export type CardReact = ReactLike

// The stable shim. Every member delegates at call time, so the object is
// created at module load without touching the (not yet wired) react module.
export const react: CardReact = {
  createElement: (type, props, ...children) =>
    getReactModule().createElement(type, props, ...children),
  get Fragment() {
    return getReactModule().Fragment
  },
  useState: (initial) => getReactModule().useState(initial),
  useRef: (initialValue) => getReactModule().useRef(initialValue),
  useEffect: (effect, deps) => getReactModule().useEffect(effect, deps),
  useSyncExternalStore: (subscribe, getSnapshot) =>
    getReactModule().useSyncExternalStore(subscribe, getSnapshot),
}
