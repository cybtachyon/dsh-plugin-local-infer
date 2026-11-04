# TASK-007: Build, test, and lint

## Context

The Basalt fix (TASK-002, TASK-003, TASK-004, TASK-005) and the test updates
(TASK-006) must clear the repo gates before the work is considered done.

## Work

1. Run `pnpm build` (runs `tsc -b`, then `node scripts/build-client.mjs` to
   produce the `dsh/client.js` card artifact). It must pass.
2. Run `pnpm test` (runs `vitest run`). The full suite must pass, including the
   updated Basalt spec.
3. Run `pnpm lint` (runs `eslint .`). It must pass.
4. Run `prek run --files <changed paths>` before committing (verify the
   pre-commit hooks).

## Definition of Done

- `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
- `prek run --files <changed paths>` passes.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
