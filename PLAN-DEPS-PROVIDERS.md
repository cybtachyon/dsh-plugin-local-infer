# PLAN-DEPS-PROVIDERS

Resolve the `deps` ↔ `providers` circular import in the client store.
`packages/client/src/store/deps.ts` imports `appendCanceledLog` from
`./providers.ts` while `providers.ts` imports `repriceDeps` and
`repriceSummary` from `./deps.ts`. Extract the shared Logs-buffer helpers
(`seedProcessLog`, `appendProcessLog`, `appendCanceledLog`) into a new
`packages/client/src/store/logs.ts` so both modules import the helpers from
the new leaf module and the cycle disappears.

## Verification guidelines

- Gates: `pnpm build` (tsc -b + client bundle), `pnpm test` (vitest run),
  `pnpm lint` (eslint .). All three must pass before a task is done.
- The `packages/client/lib/` tree is tsc output; edit `src/` only and let
  `pnpm build` regenerate `lib/`.
- After `pnpm build`, expect trailing-newline churn in ~70 lib `.js` /
  `.d.ts.map` files; stage and commit them, the end-of-file-fixer hook
  normalizes them.
- No new runtime behavior: the refactor is import-graph only, plus the
  optional DRY substitution decided in the questionnaire.
- Run `prek` before committing (repo pre-commit hooks).

## Open questions

1. Scope of the DRY pass: `deps.ts` `performGet` seeds the Logs buffer
   inline with the same pattern as `seedProcessLog`
   (`packages/client/src/store/deps.ts` L234-243). Replace that inline seed
   with a shared `seedProcessLog(store, t.getting)` call, or keep the
   extraction minimal (move helpers only, leave `deps.ts` `performGet`
   untouched)?
   **Answer:** Yes, DRY the seed. Replace the inline seed in `deps.ts`
   `performGet` with `seedProcessLog(store, t.getting)`.

## Micro-tasks

### Phase 1: Extraction

- [x] TASK-001: Create `packages/client/src/store/logs.ts` holding
  `seedProcessLog`, `appendProcessLog`, and `appendCanceledLog` (moved
  verbatim from `providers.ts`, keeping their doc comments). Update
  `deps.ts` to import `appendCanceledLog` from `./logs.ts` (drop the
  `./providers.ts` import). Update `providers.ts` to import the three
  helpers from `./logs.ts` and delete the local definitions. If the
  questionnaire answer is "DRY", also replace the inline seed in
  `deps.ts` `performGet` with `seedProcessLog(store, t.getting)`.
  Definition of done: no import edge between `deps.ts` and `providers.ts`;
  `pnpm build` and `pnpm test` pass.
- [x] TASK-002 (Refactor): Review the files touched by the previous 1
  commits and identify the following code risks:
  - **Multiple Sources of Truth**: Same calculations done in multiple places.
  - **Duplicate Code**: Nearly-identical code in multiple methods.
  - **Bloaters**: Too many things done in a single method or class.
  - **Data Clumps**: Single variables that travel in a group for multiple methods.
  - **Shotgun Edits**: Commits with singular changes that touch multiple files.
  - **Feature Envy**: Method where over 50% of the code manipulates a different class.
  - **Magic Numbers**: Literals without context in method bodies.
  Then address and resolve each risk.
  Definition of done: each identified risk is resolved in the touched files
  or explicitly noted as accepted in the commit message; `pnpm build` and
  `pnpm test` pass.
- [x] TASK-004: Fix the stale task-id doc-comment references discovered
  by TASK-001 (pre-existing): `packages/client/src/store/derive.ts`
  (L120, L155, L165, "TASK-011"), `packages/client/src/store/deps.ts`
  (L357, "TASK-016"), `packages/client/src/render/LogsPanel.tsx` (L84,
  "TASK-010") point at the Get-progress plan that commit 6dba961 removed.
  Rewrite the comments to name the behavior, not the dead task id.
  Definition of done: no `TASK-0NN` references remain in
  `packages/client/src`; `pnpm build` and `pnpm test` pass.
- [ ] TASK-003: Run the full gate set (`pnpm build`, `pnpm test`,
  `pnpm lint`) and confirm the client bundle (`dsh/client.js`) contains no
  import edge between the deps and providers store modules.
  Definition of done: all three gates pass; commit the verified state.

## Task dependencies

- TASK-002 depends on TASK-001 (it reviews the commit TASK-001 produces).
- TASK-004 depends on TASK-002 (comment cleanup after the refactor pass).
- TASK-003 depends on TASK-004 (final verification after all code changes).
