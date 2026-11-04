# PLAN-SYNC-OVERRIDE

## Objective

Update the Get process (`runGetSteps`) to accept an override from the Launch
process (`launchEngine`), so a Get process that cannot rebase / update the
engine checkout does not halt the Launch process even when "Auto Rebuild" is
checked. The Get error is printed to the card's Logs section textarea (the
persisted last-run logs) and the log file, and the launch then continues with
the current version of the checkout.

## Verification guidelines

- New behavior is covered by vitest tests in `packages/ui/tests/route.spec.ts`
  on the existing `stubGetHost` / `stubService` harness, asserting:
  - a Get run with the override on reports the sync failure without failing
    the run (the result carries a `syncFailed` flag),
  - the launch passes `autoRebuild: false` to the deploy step after a Get sync
    failure, so the deploy's own git sync is skipped and the current version
    launches,
  - the persisted `lastLogs` (the Logs section) and the log file carry the Get
    error line.
- The standalone Get route (`getEngine`) keeps its current behavior: a sync
  failure stops a Get run.
- This is a host-side change: verify by a bundle reinstall (or a bundle
  toggle off/on), not by a page refresh.

## Open questions

Answers are recorded beside each question as they arrive.

1. **Scope**: when the override is active, which Get step failures are
   non-fatal? Only the git sync (rebase/update) step, or also the source build
   step that follows it?
   - Answer: only the git sync (rebase/update) step. A failed source build
     after a successful rebase stays fatal.
2. **Missing checkout**: when no checkout exists at all (a clone failure),
   there is no "current version" to launch. Does the launch stay fatal in that
   case, or continue and let the deploy step surface the failure?
   - Answer: stay fatal. A clone failure halts the launch as today; only
     rebase/update failures of an existing checkout are non-fatal.
3. **Get route**: does the standalone Get route (`/local-infer/get`) also
   accept the override, or is the override Launch-only?
   - Answer: Launch-only. `getEngine` does not pass the override; a
     standalone Get keeps stopping on a sync failure.

## Task dependencies

- TASK-002 depends on TASK-001 (the launch wiring reads the `syncFailed`
  result field TASK-001 adds).
- TASK-003 (Refactor) depends on TASK-001 and TASK-002 (it reviews their
  commits).
- TASK-004 (Verify) depends on TASK-003.

## Phase 1: Get process override

- [ ] [TASK-001-GET-STEP-OVERRIDE](docs/PLAN-SYNC-OVERRIDE-TASK-001-GET-STEP-OVERRIDE.md)
- [ ] [TASK-002-LAUNCH-WIRING](docs/PLAN-SYNC-OVERRIDE-TASK-002-LAUNCH-WIRING.md)

## Phase 2: Refactor

- [ ] [TASK-003-REFACTOR](docs/PLAN-SYNC-OVERRIDE-TASK-003-REFACTOR.md)

## Phase 3: Verification

- [ ] [TASK-004-VERIFY](docs/PLAN-SYNC-OVERRIDE-TASK-004-VERIFY.md)
