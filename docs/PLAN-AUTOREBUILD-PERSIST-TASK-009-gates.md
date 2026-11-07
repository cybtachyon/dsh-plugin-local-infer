# TASK-009 - Whole-repo gates and build artifacts

- Run, in order, quoting the passing output into the commit message or a note:
  1. `pnpm build` (tsc -b, `scripts/build-client.mjs`, `scripts/build-format.mjs`)
  2. `pnpm test`
  3. `pnpm test:coverage` (clears `vitest.config.ts` thresholds: lines 90 /
     functions 93 / branches 78 / statements 90)
  4. `pnpm lint`
- Commit the tracked emitted outputs (`packages/*/lib`, `dsh/client.js`) if any
  task left them unemitted.
- DoD: all four commands green, `git status --short` clean afterwards.
