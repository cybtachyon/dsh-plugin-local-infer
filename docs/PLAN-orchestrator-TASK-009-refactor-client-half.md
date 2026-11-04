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
