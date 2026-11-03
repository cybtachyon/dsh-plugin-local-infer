# TASK 014 — Add the Basalt test suite

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 009, TASK 010, TASK 011, TASK 012, TASK 013

## What

Create `packages/providers/tests/basalt.spec.ts` (the assertions from
TASK 009–TASK 013 consolidated), mirroring the structure of
`packages/providers/tests/strata.spec.ts`.

## Definition of Done

- `pnpm test` passes for the new suite and the full suite.
- `pnpm test:coverage` clears the thresholds in `vitest.config.ts` (lines 90 /
  functions 93 / branches 78 / statements 90).
