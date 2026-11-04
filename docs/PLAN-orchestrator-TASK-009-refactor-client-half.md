# TASK-009: Refactor (client and wiring half)

Review the files touched by the previous 3 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Definition of Done: each risk listed is either resolved or explicitly reported
as not present; `pnpm build && pnpm test && pnpm lint` stay green (rebuild
`dsh/client.js` if sources changed, amended into the refactor commit); one
commit if code changed, otherwise a short note here and no commit.

## Answered open questions

(none specific to this task)

## Carry-over notes from TASK-008 (2026-11-04)

- The rebuild had to update the carrier pins in TWO suites in lockstep:
  `packages/client/tests/carrier.spec.ts` (the home named by TASK-008) and
  the older mirror `packages/ui/tests/client.spec.ts` (missed by the
  TASK-007 carry-over note). Both now load the same `dsh/client.js` with
  near-identical harnesses; the Duplicate Code review here should weigh
  consolidating the carrier-bootstrap behavior pins into carrier.spec.ts
  (its header already claims that role) and keeping only the source-pins in
  the ui suite.
- The committed `packages/client/lib` outputs lagged `packages/client/src`
  (TASK-007 shipped no lib outputs), so this artifact commit also lands the
  routes/plugin/text lib updates plus the new `OrchestratorCard.*`. A later
  plan can pin whether lib outputs must land with each source commit.
- `tsc -b` reported "up to date" over deleted outputs because a `git clean`
  after a verification build removed the new lib files but kept the
  git-ignored `packages/*/tsconfig.tsbuildinfo`. If a rebuild emits nothing
  while outputs are missing, delete the tsbuildinfo files and rebuild.
