# TASK-002: Launch wiring (`packages/ui/src/ops/engine.ts`)

Wire the override into the Launch process:

- `launchEngine` passes `continueOnSyncFailure: true` to `runGetSteps`.
- After the Get run, when `get.syncFailed === true`, pass `autoRebuild: false`
  to `localInfer.launch` so the deploy step skips its own git sync (which
  would hit the same rebase conflict) and launches the current version. A
  Get run whose sync passed keeps the request's `autoRebuild`.
- The Get error line already flows through `getLogs` into
  `composeLaunchLogs` and `persistLaunchOutcome` (the persisted last-run logs
  and the log file); add a test that asserts the persisted `lastLogs` and the
  log file carry the Get error line after a sync-failure launch.
- Update the `launchEngine` doc comment to describe the override.
- Tests:
  - Get sync failure + override -> `localInfer.launch` is called with
    `autoRebuild: false`, the result is healthy (stub), and the persisted
    `lastLogs` carries the Get error line under the `--- Launching...`
    header,
  - Get sync success -> the launch options carry the request's `autoRebuild`
    unchanged.

Definition of Done: `pnpm build` passes; the new tests pass; the existing
launch tests are unchanged and pass.
