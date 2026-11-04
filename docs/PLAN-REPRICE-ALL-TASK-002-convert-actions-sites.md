# TASK-002: Convert every `actions.ts` reprice site to `repriceAll`

File: `packages/client/src/store/actions.ts`

1. In `performDiscard`, replace the pair
   ```ts
   void repriceSummary(store)
   void repriceDeps(store)
   ```
   with
   ```ts
   void repriceAll(store)
   ```
2. Convert the three standalone summary-only sites to `repriceAll` (the
   scope answer: all call sites adopt the helper):
   - `performRegister` (after a published entry):
     `void repriceSummary(store, { engine: draft.engine, config: draft.config })`
     becomes
     `void repriceAll(store, { engine: draft.engine, config: draft.config })`.
   - `performUnregister` (after a removal): same conversion.
   - `performDownload` (after a successful pull): same conversion.
3. Update the import to `import { repriceAll } from './deps.ts'`
   (no `repriceSummary` / `repriceDeps` use remains in this file).
4. Keep the doc comments accurate: the register/unregister/download
   comments say "re-fetches the summary". Widen them to say the reprice
   re-fetches both read models (the summary and the deps panel) through
   `repriceAll`.

Side-effect handling (from the plan's evaluation): a transient deps probe
failure clears the deps model (`deps/clear`) and hides the panel. That is
the established `repriceDeps` semantics, already exposed at every pair
site, and the panel returns on the next successful reprice. No code
change.

## Definition of Done

- `grep -n "repriceSummary\|repriceDeps" packages/client/src/store/actions.ts`
  returns no matches.
- All four sites use `repriceAll`.
- `pnpm build` type-checks (`tsc -b` clean).
- Committed with the message
  `refactor(client): route the actions reprice sites through repriceAll`.
