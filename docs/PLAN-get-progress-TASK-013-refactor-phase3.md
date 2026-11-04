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

The Phase 3 commits:
- 53fec0e the `'getting'` control branch, `formatProgressReadout`, and the
  readout text keys
- 3810ad2 the `ProviderRow` dot + readout and the `unit: 'bytes' | 'files'`
  field (core `HfProgress`, client `HfProgressShape`, both parsers, the
  unit-aware readout)
- 3b37f8d the custom thin CSS progress strip (`PROGRESS_STRIP_TRACK`,
  `progressStripFillStyle`, `renderProgressStrip`, the `Card.tsx` `'getting'`
  branch)

Files: `packages/client/src/store/derive.ts`, `packages/client/src/text.ts`,
`packages/client/src/render/ProviderList.tsx`, `packages/core/src/progress.ts`,
`packages/client/src/api/routes.ts`, `packages/client/src/store/progress.ts`,
`packages/client/src/styles.ts`, `packages/client/src/render/primitives.tsx`,
`packages/client/src/Card.tsx`.

Known accepted risks to note (do not re-litigate, but confirm they are
documented where a future reader would look):
- The client tqdm parser mirrors the pure core parser (a cross-boundary
  duplication the host/browser split forces).
- The guarded `Progress` member on `PrimitivesModule` is forward-looking
  (the installed primitives seed exports no `Progress` component); the
  `renderProgressStrip` guard picks it up automatically if the seed adds one.

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test;
  delete the gitignored `packages/*/tsconfig.tsbuildinfo` files first if
  `tsc -b` skips re-emitting).
