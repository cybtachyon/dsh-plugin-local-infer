# PLAN-summary-churn: Fix the 2-line re-emit churn in the ui lib summary.js

## Objective

`packages/ui/lib/viewmodels/summary.js` churns 2 lines on every tsc re-emit of the ui
package, absorbed by the prek commit hooks: tsc collapses the multi-line `renderMeter(`
call in `packages/ui/src/viewmodels/summary.ts` onto one line and emits a trailing space
after `estimate.reserveSource,` (the `trailing-whitespace` hook strips it at commit
time), and tsc emits files without a final newline (the `end-of-file-fixer` hook and
`scripts/build-format.mjs` add one). Fix the source call so tsc emits a stable line,
harden the build pipeline to own the whitespace normalization, and verify a re-emit of
`summary.js` is byte-stable apart from the repo-wide trailing-newline delta.

## Answers (questionnaire, 2026-11-04)

1. Scope: source fix **plus** `scripts/build-format.mjs` hardening (TASK-004 active).
2. Gates: full `pnpm test` (coverage thresholds) plus `pnpm lint` before the fix
   commit (run in TASK-002).

## Verification guidelines

- Churn check: after `npx tsc -b --force`,
  `git diff --numstat -- packages/ui/lib/viewmodels/summary.js` must show at most `1 1`
  (the shared trailing-newline delta). A `2 2` means the trailing-space line still
  churns. `git diff` on that file must show no `+` line with trailing whitespace.
- Stability check: `pnpm build` leaves the whole tree clean (`git status --short`
  empty).
- Gate commands (build, test, lint, prek) are defined in AGENTS.md; run them, do not
  restate them here.

## Tasks

Execution order: TASK-001, TASK-002, TASK-004, TASK-003, TASK-005.

### Phase 1: Source fix

- [x] [TASK-001-restructure-meter-call](docs/PLAN-summary-churn-TASK-001-restructure-meter-call.md)

### Phase 2: Re-emit and verify

- [x] [TASK-002-reemit-verify-gates](docs/PLAN-summary-churn-TASK-002-reemit-verify-gates.md)

### Phase 3: Build hardening

- [x] [TASK-004-build-format-trim](docs/PLAN-summary-churn-TASK-004-build-format-trim.md)

### Phase 4: Housekeeping

- [x] [TASK-003-update-memory-note](docs/PLAN-summary-churn-TASK-003-update-memory-note.md)

### Phase 5: Pre-existing issue (found during TASK-004)

- [x] [TASK-005-build-format-dead-fallback](docs/PLAN-summary-churn-TASK-005-build-format-dead-fallback.md)

## Refactor task

Not injected: the fix touches one source file plus the build script; the preceding
commits are plan-doc commits with no code surface worth a refactor-review pass.

## Dependencies

- TASK-002 depends on TASK-001 (the re-emit needs the restructured source).
- TASK-004 is independent of TASK-001 and TASK-002; it runs after TASK-002 because its
  verification reuses the same build chain.
- TASK-003 depends on TASK-004 (the note records the complete fix, including the
  hardening commit).
- TASK-005 is a cleanup of a pre-existing dead-code fallback in
  `scripts/build-format.mjs`, found during TASK-004; it runs after TASK-003.
