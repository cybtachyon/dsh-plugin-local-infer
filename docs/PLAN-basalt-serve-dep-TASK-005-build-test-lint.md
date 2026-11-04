# TASK-005: Build, test, and lint

## Context

The Basalt serve-dep fix (TASK-001) and the early-exit health poll (TASK-002,
TASK-003, TASK-004) must clear the repo gates before the work is considered
done.

## Work

1. Run `pnpm build` (runs `tsc -b`, then `node scripts/build-client.mjs` to
   produce the `dsh/client.js` card artifact). It must pass.
2. Run `pnpm test` (runs `vitest run`). The full suite must pass, including the
   updated `basaltPip` dep spec and the new early-exit `pollHealth` tests.
3. Run `pnpm lint` (runs `eslint .`). It must pass.
4. Run `prek run --files <changed paths>` before committing (verify the
   pre-commit hooks).

## Definition of Done

- `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
- `prek run --files <changed paths>` passes.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
