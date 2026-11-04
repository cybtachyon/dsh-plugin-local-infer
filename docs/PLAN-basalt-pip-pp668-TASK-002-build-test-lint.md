# TASK-002: Build, test, and lint

## Context

The basaltPip `--break-system-packages` fix (TASK-001) must clear the repo gates
before the work is considered done.

## Work

1. Run `pnpm build` (runs `tsc -b`, then `node scripts/build-client.mjs` to
   produce the `dsh/client.js` card artifact). It must pass.
2. Run `pnpm test` (runs `vitest run`). The full suite must pass, including the
   updated `basaltPip` install-command assertions.
3. Run `pnpm lint` (runs `eslint .`). It must pass.
4. Run `prek run --files <changed paths>` before committing (verify the
   pre-commit hooks).

## Definition of Done

- `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
- `prek run --files <changed paths>` passes.
- The task is checked `[x]` in `PLAN-basalt-pip-pp668.md`.
