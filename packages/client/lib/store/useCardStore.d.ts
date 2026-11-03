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
import { type CardAction, type CardState } from './types.ts';
/**
 * ReactLike is the react surface the card calls. The full react type is a
 * runtime external, not a compile dependency, so the card names only what it
 * calls: the classic transform's createElement and Fragment, the hooks the
 * components and the store binding use.
 */
export interface ReactLike {
    createElement(type: unknown, props: unknown, ...children: unknown[]): unknown;
    Fragment: unknown;
    useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
    useRef<T>(initialValue: T): {
        current: T;
    };
    useEffect(effect: () => (void | (() => void)), deps?: unknown[]): void;
    useSyncExternalStore<Snapshot>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => Snapshot, getServerSnapshot?: () => Snapshot): Snapshot;
}
/**
 * CardStoreInstance is the per-mount store instance: the live state read,
 * dispatch, the subscribe seam, and getSnapshot. It structurally satisfies
 * the CardStore interface in store/sync.ts (dispatch + getSnapshot), so
 * performAction drives it directly.
 */
export interface CardStoreInstance {
    /** The current snapshot, read live; a dispatch replaces it. */
    readonly state: CardState;
    dispatch(action: CardAction): void;
    subscribe(listener: () => void): () => void;
    getSnapshot(): CardState;
}
/**
 * setReactModule hands the bootstrap's resolved react module to the store
 * binding. mountCard calls it after its require('react') succeeds, so the
 * hook reads the same frozen-table module the card renders with.
 */
export declare function setReactModule(react: ReactLike): void;
/**
 * getReactModule returns the bootstrap's resolved react module. It throws if
 * setReactModule has not run, so a render before the bootstrap wired react
 * fails loudly (the same contract the hook has).
 */
export declare function getReactModule(): ReactLike;
/**
 * createCardStore builds one per-mount store instance. dispatch reduces the
 * action over the current snapshot through cardReducer and notifies
 * subscribers only when the snapshot identity changes, so a no-op dispatch
 * (a late ack after the deadline) never re-renders a bound component.
 */
export declare function createCardStore(): CardStoreInstance;
/**
 * useCardStore binds the per-mount store instance to a component. The
 * instance is created once per mount (useRef) and shared by every render of
 * that component; the useSyncExternalStore call subscribes the component, so
 * a dispatch re-renders it and store.state reads the fresh snapshot. Child
 * components take the instance as a prop; only the owner calls the hook.
 */
export declare function useCardStore(): CardStoreInstance;
//# sourceMappingURL=useCardStore.d.ts.map
