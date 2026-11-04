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

The Phase 2 commits:
- 9babae5 the `parseHfProgress` parser and `deriveGetStep` helper
  (`packages/client/src/store/progress.ts`)
- 92875b2 the `CardUiState.getProgress` field (`packages/client/src/store/types.ts`)
- 4849cbf the `performGet` throttle (`packages/client/src/store/deps.ts`)

Known accepted risks to note (do not re-litigate, but confirm they are
documented where a future reader would look):
- The client tqdm parser (`packages/client/src/store/progress.ts`) mirrors
  the pure core parser (`packages/core/src/progress.ts`): a cross-boundary
  duplication the host/browser split forces (core is not browser-safe).

Known stale doc to fix in this pass:
- `performGet`'s doc comment opening line in `packages/client/src/store/deps.ts`
  still says "the get route's text stream" (pre-TASK-004 wording; the route
  is NDJSON now).

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- The stale "text stream" doc line is corrected.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test;
  delete the gitignored `packages/*/tsconfig.tsbuildinfo` files first if
  `tsc -b` skips re-emitting).
