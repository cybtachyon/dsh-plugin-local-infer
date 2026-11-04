# TASK-004: Refactor: code-risk review of recently touched files

Run after TASK-001/002/003 so the review covers both the recent commit history
and the files those tasks just changed.

## Work

Review the files touched by the previous 5 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Focus areas (the files the recent commits and TASK-001/002/003 touch):
`packages/ui/src/ops/engine.ts`, `packages/ui/src/ops/hf.ts`,
`packages/ui/src/ops/logs.ts`, `packages/providers/src/acquire.ts`,
`packages/providers/src/engines/basalt/basaltAdapter.ts`,
`packages/core/src/models.ts`, `packages/core/src/hf-cache.ts`,
`packages/client/src/store/deps.ts`, `packages/client/src/text.ts`.

## Definition of Done

- Each of the seven risk categories is checked against the named files; every
  risk found is resolved (or explicitly noted as accepted with a reason).
- The refactor keeps `pnpm build`, `pnpm test` (with coverage thresholds), and
  `pnpm lint` green.
- The resolved risks are committed with a message naming the risk addressed.
