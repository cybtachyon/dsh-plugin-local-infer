# TASK-003: Refactor

Review the files touched by the previous 2 commits and identify the following
code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Definition of Done: each identified risk is resolved in code (or recorded as
a deliberate no-op with a reason in the commit message); `pnpm build` and
`pnpm test` pass.

## Resolution

Risks found in the files touched by TASK-001 and TASK-002, and their
disposition:

- **Multiple Sources of Truth** (resolved): the "does the checkout exist"
  decision was made twice with two mechanisms: `syncEngineRepo` probes it with
  a git `rev-parse`, and `runSyncBuildStep` re-derived it with
  `existsSync(directory)` to price a sync failure's fatality. A partially
  created checkout would read as present. `syncEngineRepo` now reports the
  path it took via a `cloned` flag on a new `SyncStepResult`; the Get step
  reads `sync.cloned` instead of re-probing, so the presence decision lives in
  the one place that probes it.
- **Duplicate Code / Data Clump** (resolved): `getEngine` and `launchEngine`
  each built the same `GetStepsRequest` (the host, signal, and onChunk triple
  traveling together) with identical exactOptionalPropertyTypes-safe spreads.
  Extracted `getStepsRequest` in engine.ts; both callers use it and layer
  their own extras.
- **Bloaters** (resolved): `launchEngine`'s get-failed block (build the
  unhealthy result, persist, return) is extracted into `settleGetFailure`.
- **Duplicate Code** (resolved): the "rebuild the provider entry without the
  launch key" shape was repeated in `clearLaunchRecord`, `handleEngineDeath`,
  and `relinkStoredProviders`. Extracted `withoutLaunchRecord`.
- **Feature Envy** (deliberate no-op): the orchestrator methods
  (`launchEngine`, `stopEngine`) manipulate the `LocalInferService` by design;
  the Get-step `GetStepContext` already resolves the data-clump of step state.
- **Shotgun Edits** (deliberate no-op): each commit touched source plus its
  tests and the plan file; TASK-002's `launchAutoRebuild` change needed no
  providers edit because the deploy step already read `autoRebuild`.
- **Magic Numbers** (deliberate no-op): no new production literals; the
  `port: 18020` in the new tests is fixture data, and `LOG_TAIL_BYTES` is a
  named constant.

`pnpm build`, `pnpm test` (1367 tests), and `pnpm lint` pass.
