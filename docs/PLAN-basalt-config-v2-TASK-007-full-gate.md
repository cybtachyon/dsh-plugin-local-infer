# TASK-007: Full repo gate

## Goal

Prove the whole plugin is green with the v2 provider:

1. `pnpm build` (tsc -b + client bundle + format normalize; tree stays clean).
2. `pnpm test` (full vitest suite).
3. `pnpm test:coverage` clearing the `vitest.config.ts` thresholds
   (lines 90 / functions 93 / branches 78 / statements 90).
4. `pnpm lint` (repo-wide eslint).
5. `prek run --files <every path touched by this plan>`.

Fix whatever the gates surface (within this plan's scope; note pre-existing
unrelated breakage for the parent instead of silently fixing it).

## Definition of Done

- All five gates pass on the final tree.
- `git status --porcelain` is empty after the last commit (no un-emitted or
  churned artifacts).

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
