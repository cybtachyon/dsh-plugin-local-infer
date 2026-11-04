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
