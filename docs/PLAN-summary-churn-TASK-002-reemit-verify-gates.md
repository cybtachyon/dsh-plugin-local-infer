# TASK-002: reemit-verify-gates

## Context

TASK-001 restructured the `renderMeter(` call in
`packages/ui/src/viewmodels/summary.ts` so tsc no longer emits a trailing space into
`packages/ui/lib/viewmodels/summary.js`. This task proves the churn is gone and runs
the full verification gates (selected in the plan questionnaire: full `pnpm test` plus
`pnpm lint`).

## Work

1. Churn check: run `npx tsc -b --force`, then
   `git diff --numstat -- packages/ui/lib/viewmodels/summary.js`. It must show at most
   `1 1` (the shared trailing-newline delta every lib file shows). A `2 2` means the
   trailing-space line still churns; report it and stop. Also confirm
   `git diff -- packages/ui/lib/viewmodels/summary.js` shows no `+` line with trailing
   whitespace.
2. Restore the churned tree: `git restore .`
3. Run `pnpm build` and confirm `git status --short` is clean.
4. Run the full gates: `pnpm test` (the suite must clear the coverage thresholds in
   `vitest.config.ts`) and `pnpm lint`.
5. Run `prek run --files` over the files this plan touched (the source file, the
   re-emitted lib files, and the plan files).
6. Commit the plan check-off (mark this task `[x]` in
   `PLAN-summary-churn.md`).

## Definition of Done

- The `summary.js` numstat after a forced re-emit is at most `1 1`, with no
  trailing-whitespace `+` line.
- `pnpm build` leaves a clean tree.
- `pnpm test` and `pnpm lint` are green.
- The check-off is committed.
