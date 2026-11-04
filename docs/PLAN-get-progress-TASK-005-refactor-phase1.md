# TASK-005: Refactor Phase 1

Review the files touched by the previous 8 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

## Scope

The Phase 1 commits:
- e4f7be4 `--format human` in the core command builders
- 96b48f5 `--format human` in the Infernix extra-download commands
- 6b67d3f the spawn-based `downloadRunner` with `onChunk`
- c3e2f41 the service `watchChildAbort` SIGTERM guard fix
- 1d79fa2 the providers `watchChildAbort` SIGTERM guard fix
- 4cbcaae the get-steps `onChunk` sink
- 6416c0a the Infernix extra-download chunks routed to the progress sink
- 837f370 the NDJSON get route, the launch route `progress` events, the core
  tqdm parser, and the client stream readers

Files: `packages/core/src/models.ts`, `packages/core/src/progress.ts`,
`packages/service/src/index.ts`, `packages/service/src/types.ts`,
`packages/providers/src/engines/infernix/infernix.ts`,
`packages/providers/src/adapters.ts`, `packages/core/src/adapter.ts`,
`packages/ui/src/ops/get-steps.ts`, `packages/ui/src/ops/engine.ts`,
`packages/ui/src/routes/get.ts`, `packages/ui/src/routes/launch.ts`,
`packages/client/src/api/routes.ts`.

Known accepted risks to note (do not re-litigate, but confirm they are
documented where a future reader would look):
- The core tqdm parser (`packages/core/src/progress.ts`) is mirrored by the
  client's `store/progress.ts` parser (TASK-006): a cross-boundary
  duplication the host/browser split forces (core is not browser-safe).
- The two `watchChildAbort` copies (service + providers) are near-identical
  by design (each package owns its own child-process wiring); the guard fix
  was applied to both.

## Definition of Done

- Each identified risk is resolved (or explicitly noted as accepted with a
  reason in the commit message).
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test;
  delete the gitignored `packages/*/tsconfig.tsbuildinfo` files first if
  `tsc -b` skips re-emitting).
