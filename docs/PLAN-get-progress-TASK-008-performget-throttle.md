# TASK-008: populate `getProgress` in `performGet`'s append closure, throttled to ~2 Hz

## Context

`performGet` in `packages/client/src/store/deps.ts` streams the get route's
answer. Per the plan decision the get route now streams NDJSON (TASK-004):
`{ log }` events feed the Logs buffer and `{ progress }` events carry
structured progress. `performGet`'s `append(chunk)` closure appends each log
chunk to the Logs buffer (`ui.logs.getLogs`) and re-arms the idle cap.
`parseHfProgress` (TASK-006) folds the raw tqdm text in the log chunks into
a `GetProgressState`; `CardUiState.getProgress` (TASK-007) is the field to
populate.

## Change

- `packages/client/src/store/deps.ts` (`performGet`):
  - Pass an `onProgress` callback to `postGet` (TASK-004): a structured
    `{ progress }` event sets `getProgress` directly (throttled).
  - In the `append` closure, run the log chunk through `parseHfProgress`
    and, when it yields a state, dispatch a `ui/patch` setting
    `getProgress` (throttled). The structured event wins when both arrive
    (it is the server-parsed state); the text parse is the fallback for
    hosts that stream log text without progress events.
  - Throttle: a 500 ms minimum interval between `getProgress` patches
    (~2 Hz); the latest state always lands on the final chunk and when the
    run settles.
  - When the run settles (success, failure, or abort), clear
    `getProgress` back to `null` (the readout should not outlive the run).
- Keep the existing Logs-buffer append and idle-cap behavior intact.

## Definition of Done

- A test with a stubbed `postGet` that emits `{ log }` tqdm chunks asserts
  `getProgress` is populated (throttled: no more than ~2 updates per second
  for a burst of chunks) and cleared to `null` when the run settles.
- A test with a stubbed `postGet` that emits `{ progress }` events asserts
  the structured state lands in `getProgress` (throttled) and wins over the
  text-parsed state.
- The Logs buffer still receives every log chunk (no progress parsing side
  effect drops log text).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/store/deps.ts`
- the client deps/performGet tests (under `packages/client/tests/`).
