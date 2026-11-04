# TASK-013: Refactor Phase 3

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

The Phase 3 commits: the `'getting'` control branch and
`formatProgressReadout`, the `ProviderRow` dot + readout, and the custom
progress strip. Files: `packages/client/src/store/derive.ts`,
`packages/client/src/text.ts`, `packages/client/src/render/ProviderList.tsx`,
`packages/client/src/styles.ts`,
`packages/client/src/render/primitives.tsx`.

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.
