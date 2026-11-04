# TASK-004: NDJSON get route with `{ log }` + `{ progress }` events; `{ progress }` kind on the launch route

## Context

Per the plan decision, the get route (POST /local-infer/get) switches from
plain text to NDJSON, and both the get and launch routes emit a
`{ progress }` event kind. `RouteResponder` already has an
`ndjsonStream()` opener (the launch route uses it). The launch route
(`packages/ui/src/routes/launch.ts`) streams NDJSON: a `step` event as each
phase begins, then a final `result` event. The client readers live in
`packages/client/src/api/routes.ts` (`readNdjsonLines`,
`readLaunchStream`, `readTextStream`, `postGet`).

The raw tqdm stderr reaches the routes through the `onChunk` sink
(TASK-003). A pure server-side parser turns the tqdm lines into structured
progress.

## Change

- New `packages/core/src/progress.ts` (pure, no node imports so it stays
  shareable): the `HfProgress` shape
  (`{ step: string; percent: number; doneBytes: number; totalBytes: number; etaSeconds: number }`)
  plus a pure line parser (`parseHfProgressLine`) and a chunk folder
  (`foldHfProgressChunk(chunk, prior)`) that recognize the two tqdm shapes
  (`Fetching N files: 42%|…| 43/102` and
  `Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]`),
  convert human byte sizes to bytes, and convert the ETA tail to seconds.
  Export from the core index.
- `packages/ui/src/routes/get.ts`:
  - Switch `res.textStream()` to `res.ndjsonStream()`.
  - Emit `{ log: text }` NDJSON events for the log text (the `collected`
    buffer stays plain text for `persistProcessLog`).
  - Wire the `onChunk` sink (TASK-003) through the core chunk folder and
    emit a `{ progress: HfProgress }` event when a folded chunk yields a
    state (throttle server-side if the tqdm cadence is too hot, e.g. at
    most one event per ~500 ms).
- `packages/ui/src/routes/launch.ts`:
  - Extend the route's `LaunchStreamEvent` union with the
    `{ progress: HfProgress }` variant.
  - Wire `launchEngine`'s `onChunk` (TASK-003) through the same core chunk
    folder and emit `{ progress }` events between the `step` and `result`
    events. Keep the existing `step` and `result` events exactly as they
    are.
- `packages/client/src/api/routes.ts`:
  - New `GetStreamEvent` type
    (`{ log: string } | { progress: HfProgressShape }`) and a
    `readGetStream(response, onChunk, onProgress)` NDJSON reader (built on
    `readNdjsonLines`); `postGet` takes an optional `onProgress` and uses
    `readGetStream` instead of `readTextStream`.
  - Extend `LaunchStreamEvent` with the `progress` variant and give
    `readLaunchStream` an optional `onProgress` callback (default no-op, so
    existing callers are untouched).
  - `readTextStream` becomes unused after the switch: remove it (and its
    tests) to avoid dead code, or keep it if the suite still references it.

## Definition of Done

- The get route streams `{ log }` and `{ progress }` NDJSON events (a test
  with a stubbed service whose `downloadModel` invokes the `onChunk` sink
  asserts the event sequence and that the persisted log stays plain text).
- The launch NDJSON stream can carry `progress` events between the `step`
  and `result` events without breaking the existing contract (a test
  asserts a stream with step + progress + result parses and the result is
  returned).
- `readGetStream` hands log events to `onChunk` and progress events to
  `onProgress`; `readLaunchStream` forwards progress events to
  `onProgress` when given and ignores them otherwise.
- The core parser unit tests cover both tqdm shapes, `\r`-separated
  multi-update chunks, human byte-size conversion, and the ETA tail.
- The existing launch stream tests still pass unchanged in behavior.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/core/src/progress.ts` (new) + the core index export
- `packages/ui/src/routes/get.ts`
- `packages/ui/src/routes/launch.ts`
- `packages/client/src/api/routes.ts`
- the ui route tests (under `packages/ui/tests/`), the core tests (under
  `packages/core/tests/`), and the client route tests
  (`packages/client/tests/routes.spec.ts`).
