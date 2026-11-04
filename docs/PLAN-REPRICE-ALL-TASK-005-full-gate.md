# TASK-005: Full verification gate and bundle rebuild

1. Run `pnpm build` (runs `tsc -b`, then esbuild-bundles
   `packages/client/src/index.ts` to `dsh/client.js`).
2. Run `pnpm test` (the full `vitest run` suite).
3. Run `pnpm lint` (repo-wide `eslint .`).
4. Commit the rebuilt `dsh/client.js` and the re-emitted
   `packages/client/lib/**` artifacts of the changed source files (the
   end-of-file-fixer hook can modify files during the commit, so a
   re-stage and re-commit may be needed) with the message
   `chore(client): rebuild the card bundle for the repriceAll adoption`.

## Definition of Done

- `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
- The bundle `dsh/client.js` contains `repriceAll` and the converted call
  sites (the `repriceSummary` pin in `packages/ui/tests/client.spec.ts`
  still passes because the symbol stays in the bundle).
- `git status` is clean after the commit.
