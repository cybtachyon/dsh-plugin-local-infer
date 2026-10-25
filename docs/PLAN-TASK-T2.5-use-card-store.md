# T2.5 `src/store/useCardStore.ts`.

Create the per-mount store
instance (`{ state, dispatch, subscribe, getSnapshot }`) and the
`useCardStore()` hook over `react.useSyncExternalStore`.

**DoD:** non-React unit tests: dispatch changes the snapshot;
subscribers are notified on dispatch; multiple subscribers see the
same state object identity until the next dispatch; `pnpm build`
green.
