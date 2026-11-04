# TASK-001: Get step override (`packages/ui/src/ops/get-steps.ts`)

Add the override to the Get process:

- Add `continueOnSyncFailure?: boolean` to `GetStepsRequest` (the Launch
  process passes it; a standalone Get omits it).
- Add `syncFailed?: boolean` to `GetStepsResult`.
- In `runSyncBuildStep`, when `syncEngineRepo` fails and
  `request.continueOnSyncFailure === true`:
  - the checkout directory exists (a current version to launch): the error
    line is already emitted (`!! ${sync.detail}`); emit a continue note,
    skip the build step (the rebase failed, so the checkout stays at the
    current version), and report a non-fatal outcome so the run continues.
  - the checkout directory is missing (a clone failure, no current
    version): the failure stays fatal.
- `runGetSteps` threads a non-fatal sync failure into the result as
  `syncFailed: true` with `ok: true`.
- Update the module and interface doc comments to match.
- Extend `stubGetHost` in `packages/ui/tests/route.spec.ts` with a `fail`
  option (command substrings whose run fails) and add tests:
  - override on + rebase failure (checkout present) -> `ok: true`,
    `syncFailed: true`, the logs carry the error line and the continue note,
    and no build command runs,
  - override off + rebase failure -> `ok: false` (existing behavior),
  - override on + clone failure (checkout missing) -> `ok: false` (fatal,
    there is no current version to launch).

Definition of Done: `pnpm build` passes; the new tests pass; the existing
get-steps and launch tests are unchanged and pass.
