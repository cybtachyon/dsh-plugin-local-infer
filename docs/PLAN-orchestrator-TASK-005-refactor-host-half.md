# TASK-005: Refactor (host half)

Scope: the five implementation commits `f547adf` (TASK-001), `381e739`
(TASK-001b), `7e05bf7` (TASK-002), `5d0d1a4` (TASK-003), `9eda570` (TASK-004);
docs(plan) commits between them are out of scope.

Known consolidation candidates reported by earlier tasks:
- `packages/orchestrator/src/route.ts` mirrors the ui `defineRoute` template
  (ui does not export it) and duplicates the 64 KiB cap constant; decide
  between keeping the deliberate small copy (document it) or exporting/
  sharing the plumbing across the workspace packages.
- `packages/ui/tests/route.spec.ts` defines its fake req/res harness inline
  three times; the orchestrator spec mirrors a fourth copy. A shared test
  harness may be worth queuing (or extracting now).

Review the files touched by the previous 5 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Definition of Done: each risk listed is either resolved or explicitly reported
as not present; `pnpm build && pnpm test && pnpm lint` stay green; one commit
if code changed, otherwise a short note here and no commit.

## Answered open questions

(none specific to this task)
