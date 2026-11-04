# TASK-022: stop double-including the Get-step logs in the persisted launch run

## Context

Discovered during TASK-005 (dates from 482171a, before the Phase 1 commits):
on the launch success path in `launchEngine`
(`packages/ui/src/ops/engine.ts`), `composeLaunchLogs(result, getLogs, …)`
sets `result.logs = getLogs + buildLogs + commandNote + engineLogs`, and then
`persistLaunchOutcome(result, …, getLogs)` calls
`persistLaunchLogs(result, …, getLogs)`, whose body is
`getLogs + (result.logs ?? '')`. So the persisted `lastLogs` and the log file
contain the Get-step output twice. The get-failed path (which leaves
`result.logs` unset and passes `getLogs`) is correct as-is.

## Change

- `packages/ui/src/ops/engine.ts` (`launchEngine` success path): pass `''`
  for `getLogs` to `persistLaunchOutcome` (the `result.logs` field already
  carries the Get-step output via `composeLaunchLogs`), so the persisted run
  is `--- Launching...\n` + `getLogs + buildLogs + commandNote + engineLogs`
  exactly once. Keep the get-failed path unchanged (it passes `getLogs`
  because `result.logs` is unset there). Update the `persistLaunchOutcome`
  doc comment if it references the getLogs prepend.

## Definition of Done

- A test asserts: a successful launch persists the Get-step output exactly
  once in `lastLogs` (no double inclusion), and the get-failed path still
  persists the Get-step output once.
- The existing launch persistence tests still pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test).

## Files

- `packages/ui/src/ops/engine.ts`
- the ui engine/launch tests that assert the persisted run logs (under
  `packages/ui/tests/`).
