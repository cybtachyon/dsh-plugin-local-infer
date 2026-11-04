# TASK-004: Full verification gate and bundle rebuild

1. Run `pnpm build` (runs `tsc -b`, then esbuild-bundles
   `packages/client/src/index.ts` to `dsh/client.js`).
2. Run `pnpm test` (the full `vitest run` suite).
3. Run `pnpm lint` (repo-wide `eslint .`).
4. Commit the rebuilt `dsh/client.js` and the `packages/client/lib/**`
   churn (about 70 `.js` / `.d.ts.map` files whose trailing newlines tsc
   drops. The end-of-file-fixer hook normalizes them to no-ops) with the
   message `chore(client): rebuild the card bundle for the repriceAll
   adoption`.

## Definition of Done

- `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
- The bundle `dsh/client.js` contains `repriceAll` and the converted call
  sites (the `repriceSummary` pin in `packages/ui/tests/client.spec.ts`
  still passes because the symbol stays in the bundle).
- `git status` is clean after the commit.
