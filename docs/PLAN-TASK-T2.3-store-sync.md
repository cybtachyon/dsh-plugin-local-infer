# T2.3 `src/store/sync.ts`.

`performAction(store, key, run,
timeoutMs)`: dispatches `action/start`, awaits `run()`, dispatches
`action/ack`/`action/fail`, arms the deadline timer, and clears the
timer on settle. Export the per-action timeout table.

**DoD:** unit tests (with a fake timer): ack clears pending and the
timer; a rejection fails the action; a timeout marks the action
`error` and a subsequent late ack leaves state unchanged; two
concurrent `performAction` calls for the same key do not double-start
(guard on `pending`); `pnpm build` green.
