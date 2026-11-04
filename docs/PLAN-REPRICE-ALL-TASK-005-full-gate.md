# TASK-005: Full verification gate and bundle rebuild

0. First, a docs-only commit: update the now-stale comments in
   `packages/client/tests/deps.spec.ts` (the gated `performGet` tests,
   around lines 355, 567, 600, 664, and 722) that say "the summary
   re-read stays gated / hands the Logs section back". They remain true,
   but the settle re-read is now `repriceAll` (both read models), so name
   that. Commit with the message
   `docs(tests): name the repriceAll settle re-read in the Get tests`.
1. Run `pnpm build` (runs `tsc -b`, then esbuild-bundles
   `packages/client/src/index.ts` to `dsh/client.js`, then the
   `build-format.mjs` newline normalization).
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
