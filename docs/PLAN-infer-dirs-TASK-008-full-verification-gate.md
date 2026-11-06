# TASK-008: Full verification gate

Run the whole repo gate per AGENTS.md:

1. `pnpm build` (tsc -b + build-client.mjs + build-format.mjs).
2. `pnpm test` (vitest run).
3. `pnpm test:coverage` clearing the vitest.config.ts thresholds (lines 90 /
   functions 93 / branches 78 / statements 90).
4. `pnpm lint` (eslint .).
5. `prek run --files <changed paths>`.

Fix whatever fails (test expectations, coverage of new branches, lint). If
`git clean` clobbered tracked `lib/` outputs during diagnosis, delete stale
`packages/*/tsconfig.tsbuildinfo` and rebuild before committing.

Definition of Done: all five commands exit 0; any fixups committed; tree
clean (`git status --short` empty apart from plan files).

Depends on: TASK-007.
