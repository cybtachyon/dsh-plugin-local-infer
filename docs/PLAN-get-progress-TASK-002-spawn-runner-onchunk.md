# TASK-002: switch `downloadRunner` from `exec` to `spawn` and stream stderr through `onChunk`

## Context

`downloadRunner` in `packages/service/src/index.ts` (near the bottom, a
module-level const) runs the rendered hf CLI command through `exec` with a
timeout and reports the exit, keeping a kilobyte output tail for the failure
detail. `exec` buffers the whole output, so no progress reaches the caller
while a 100 GB download runs. The runner signature is
`(command: string, signal?: AbortSignal) => Promise<CommandOutcome>` and is
declared in `DownloadModelOptions.runner` in
`packages/service/src/types.ts`. `downloadModel` and
`downloadChatTemplate` (service/index.ts) call the runner with
`options?.signal`.

`watchChildAbort(child, signal)` already implements the SIGINT-then-SIGTERM
abort escalation for a ChildProcess; `spawn` returns a ChildProcess, so it
reuses.

## Change

- `packages/service/src/types.ts`: add an optional
  `onChunk?: (chunk: string) => void` field to `DownloadModelOptions` (the
  callback the runner hands each stderr chunk to).
- `packages/service/src/index.ts`:
  - `downloadRunner`: switch from `exec` to `spawn(command, { shell: true, timeout: DOWNLOAD_TIMEOUT_MS })`.
    Stream the child's stderr (and stdout) chunks to `onChunk` when present,
    while still accumulating the output tail for the failure detail. Keep the
    `watchChildAbort` wiring so an abort kills the child (SIGINT, then
    SIGTERM). Resolve `{ ok: true }` on a clean exit and
    `{ ok: false, detail }` with the tail on failure, matching today's
    contract.
  - Thread `options?.onChunk` into the runner call from `downloadModel` and
    `downloadChatTemplate` (extend the runner signature to accept the
    callback, e.g. `(command, signal, onChunk)` or an options object; keep the
    injected `runner` contract in `DownloadModelOptions` in sync).
- Update the `DownloadModelOptions` doc comment.

## Definition of Done

- The runner is spawn-based and streams stderr chunks to `onChunk` as they
  land (a test with a fake runner or a spawned `cat`-style command asserts
  chunks arrive in order).
- The output tail for the failure detail is preserved (a failing command
  still names the broken line).
- Abort behavior is intact: an aborted signal kills the child (SIGINT then
  SIGTERM) and the promise settles.
- The injected `runner` option still works (tests inject a runner to capture
  the command without a live hf).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/service/src/index.ts`
- `packages/service/src/types.ts`
- the service tests that exercise `downloadModel` / `downloadChatTemplate`
  (under `packages/service/tests/`).
