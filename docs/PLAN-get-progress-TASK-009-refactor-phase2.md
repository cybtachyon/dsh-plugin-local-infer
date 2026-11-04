# TASK-009: Refactor Phase 2

Review the files touched by the previous 3 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

## Scope

The Phase 2 commits: the `parseHfProgress` parser and `deriveGetStep`
helper, the `CardUiState.getProgress` field, and the `performGet` throttle.
Files: `packages/client/src/store/progress.ts`,
`packages/client/src/store/types.ts`, `packages/client/src/store/deps.ts`.

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.
