# TASK-001: Per-provider run-log service

Dependencies: none. Questionnaire Q2: all log updates stream as NDJSON.

Add a shared run-log hub to `packages/service` (the `ctx.localInfer`
service, `packages/service/src/index.ts` plus `types.ts`) that holds one
bounded live log buffer per run key and fans appends out to subscribers,
so every provider process writes its output to one place the streaming web
route serves.

Design:

- API on `LocalInferService` (mirror the `setSudoObserver` registration
  pattern for style):
  - `beginRun(key: string, seed: string): void` starts a run: the buffer
    resets to `seed` (the `--- <process>...` separator line), the running
    flag goes true, the monotone `seq` restarts, and subscribers get a
    `reset` notice so a mid-run attached reader replaces rather than
    appends.
  - `appendRunLog(key: string, text: string): void` appends, trims the
    buffer to `LOG_TAIL_BYTES` (import from `packages/core/src/logs.ts`),
    and notifies subscribers with the appended chunk. Appending with no
    open run lazily opens one without a seed (the death-observer note, for
    example, still lands).
  - `readRunLog(key: string): { seq: number; text: string; running: boolean }`
    answers the catch-up snapshot (mid-run page refresh, late pane open).
  - `subscribeRunLog(key: string, listener: (event) => void): () => void`
    registers a listener for `{ log }` appends and run begin/end; returns
    the disposer. Subscribers are independent per connection; a slow or
    closed connection must never block a writer.
  - `endRun(key: string): void` clears the running flag and emits the end
    event; the text stays readable until the next `beginRun` for that key.
- Run key rule (one exported helper, used by every caller so the client can
  always predict the key): the request's `providerId` when it names one,
  else the stored provider entry matched by engine + model (the
  `findLaunchTarget` rule in `packages/ui/src/ops/engine.ts`, reused not
  restated), else the engine id.
- The store lives in a new module (for example
  `packages/service/src/run-logs.ts`) so the service class stays a facade.

Definition of Done:

- [x] New module with the five operations, typed via `service/src/types.ts`.
- [x] Unit tests in `packages/service/tests/` cover: append/read snapshot,
      tail cap at `LOG_TAIL_BYTES`, begin resets seq/text and notifies
      subscribers with reset, subscriber add/remove, end event, a throwing
      or removed subscriber never breaks the writer.
- [x] `pnpm build` and `pnpm test` green.
