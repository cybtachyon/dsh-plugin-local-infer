# TASK-004: Refactor review of the conversion commits

Refactor: Review the files touched by the previous 3 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Scope note: the 3 commits are TASK-001 (`Card.tsx`), TASK-002
(`actions.ts`), and TASK-003 (`providers.ts`). Check in particular that no
`repriceSummary` + `repriceDeps` pair remains anywhere in
`packages/client/src` (a remaining pair is the duplicate-code risk this
plan removes). The one remaining `repriceSummary` site (the
`performEntryStop` fast-poll) is intentional (summary-only, per its
comment) and is not a pair.

## Definition of Done

- Every listed risk category reviewed against the three files.
- Each found risk resolved, or documented as intentional in the commit
  message.
- `pnpm build` type-checks.
- Committed with a message naming the risks resolved.
