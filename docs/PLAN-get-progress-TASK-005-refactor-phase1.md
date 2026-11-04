# TASK-005: Refactor Phase 1

Review the files touched by the previous 4 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

## Scope

The Phase 1 commits: `--format human` in the core command builders, the
spawn-based `downloadRunner` with `onChunk`, the get-steps `onChunk` sink,
and the launch route's `progress` NDJSON event kind. Files:
`packages/core/src/models.ts`, `packages/service/src/index.ts`,
`packages/service/src/types.ts`, `packages/ui/src/ops/get-steps.ts`,
`packages/ui/src/ops/engine.ts`, `packages/ui/src/routes/get.ts`,
`packages/ui/src/routes/launch.ts`, `packages/client/src/api/routes.ts`.

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.
