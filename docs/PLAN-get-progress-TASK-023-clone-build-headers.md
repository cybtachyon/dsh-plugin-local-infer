# TASK-023: emit distinct clone/build headers so the step chips track them

## Context

Discovered during TASK-014: `runSyncBuildStep`
(`packages/ui/src/ops/get-steps.ts`) is a single step that runs the git
clone/sync (`syncEngineRepo`) and the source build (`buildEngineRepo`) with no
distinct step headers, so `deriveGetStep`
(`packages/client/src/store/progress.ts`) never returns `'clone'` or
`'build'`. The five Logs-header step chips (TASK-014) therefore can never show
the clone or build chip as the running step: both read success the moment the
`model download:` header lands. The request wants five individually trackable
steps (deps / clone / build / model / template).

## Change

- `packages/ui/src/ops/get-steps.ts` (`runSyncBuildStep`): emit a distinct
  header before each sub-step so the chips can track them:
  - `emit('engine clone: …\n')` (or a similarly clear header) before
    `syncEngineRepo`.
  - `emit('engine build: …\n')` before `buildEngineRepo`.
  - Keep the existing `autoRebuild === false` skip line and the failure
    detail lines unchanged.
- `packages/client/src/store/progress.ts` (`deriveGetStep`): recognize the new
  `engine clone:` and `engine build:` headers and map them to `'clone'` and
  `'build'` respectively, so the running step tracks the clone and build
  sub-steps. Keep the existing `system dependencies` → `'deps'`,
  `model download:` → `'model'`, `chat template:` → `'template'`, and
  `get complete` → `'done'` mappings.
- The `deriveGetStepTones` helper (TASK-014) picks up the new steps
  automatically (it maps the current step to chip tones by position), so no
  change is expected there, but verify with a test.

## Definition of Done

- A Get run that clones and then builds emits the `engine clone:` and
  `engine build:` headers in order (a test with a stubbed host asserts the
  header lines land in the log in order).
- `deriveGetStep` returns `'clone'` after the `engine clone:` header and
  `'build'` after the `engine build:` header (unit tests).
- `deriveGetStepTones` reads the clone chip as running (info) after the clone
  header and the build chip as running after the build header (unit tests).
- The existing get-steps tests (the step log lines, the autoRebuild skip, the
  failure paths) still pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test).

## Files

- `packages/ui/src/ops/get-steps.ts`
- `packages/client/src/store/progress.ts`
- the ui get-steps tests (under `packages/ui/tests/`) and the client
  progress/step-chip tests (under `packages/client/tests/`).
