# TASK-007 client stream reader and entry driver

- [x] Done 2026-11-04: `pnpm vitest run packages/client` passes (500 tests),
  `pnpm lint` and `prek run --files <paths>` are clean; the tracked
  `packages/client/lib` outputs regenerate with solely this change (`dsh/`
  untouched, its rebuild stays TASK-009's).

**Phase 3. Depends on TASK-006. Definition of Done: `pnpm vitest run packages/client` passes and
`pnpm lint` is clean.**

`packages/client/src/api/routes.ts`:

- Add `{ sudo: true }` to the `LaunchStreamEvent` union and to
  `LaunchResultEvent` handling: `readLaunchStream` calls a new optional
  `onSudo?: () => void` callback when it sees the line, and the line never
  clears the collected result. Thread the callback through `postLaunch`.

`packages/client/src/store/providers.ts` `performEntryLaunch`:

- On `onSudo`: `move(store, provider.id, { type: 'sudoNeeded' })` and
  `appendProcessLog(store, SUDO_NOTE_LINE)` so the Logs textarea shows
  `Check your CLI for a sudo prompt` immediately (the same buffer the
  `--- Building...` separator writes; the host persists the same line to the
  log file).
- Arm the sudo deadline with the existing `armDeadline` seam: extend it to take
  the timeout, arm it with `SUDO_DEADLINE_MS` (host 60 s plus a 5 s grace) when
  the sudo event lands, and settle through the same
  `move(store, provider.id, { type: 'failed' })` call a health-poll timeout
  uses. One deadline variable, one settle path, so sudo, health, and stop
  timeouts all reach the red Logs state through one code path.
- `performDraftLaunch` forwards the sudo event too: it sets the `ui.sudoPending`
  flag TASK-008 renders and clears it when the run settles.

`packages/client/src/store/types.ts` and `packages/client/src/store/reducer.ts`
carry the new `ui.sudoPending` boolean (default false) that
`deriveLifecycleControl` reads for a draft launch; the reducer's `ui/patch`
path already merges partial ui fields, so only the state shape and its initial
value change.

The note line constant lives in `packages/client/src/store/logs.ts` beside
`separatorLine` so the client's copy of the string has one home; the host-side
string stays `SUDO_CLI_NOTE` in core (the client cannot import core).

Tests: `packages/client/tests/routes.spec.ts` (the reader calls `onSudo` once
and still returns the result) and `packages/client/tests/providers.spec.ts`
(the driver moves to `sudo`, appends the note line, and a 65 s timer settles
the control to `failed`).
