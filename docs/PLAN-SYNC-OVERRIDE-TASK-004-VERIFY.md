# TASK-004: Verify

Run the full gate:

- `pnpm build`
- `pnpm test` (full vitest suite)
- `pnpm test:coverage` (the suite must clear the thresholds in
  `vitest.config.ts`)
- `pnpm lint`
- `prek run --files <changed paths>`

Definition of Done: every gate is green; coverage thresholds are met; no
changed file is left uncommitted.
