# TASK-001: Convert the three `Card.tsx` reprice pairs to `repriceAll`

File: `packages/client/src/Card.tsx`

1. Replace the import
   `import { repriceDeps, repriceSummary } from './store/deps.ts'`
   with `import { repriceAll } from './store/deps.ts'`.
2. In the `scheduleReprice` debounce callback (the 300 ms field-edit
   re-price), replace the pair
   ```ts
   void repriceSummary(store, { engine: latest.engine, config: latest.config })
   void repriceDeps(store, { engine: latest.engine, config: latest.config })
   ```
   with
   ```ts
   void repriceAll(store, { engine: latest.engine, config: latest.config })
   ```
3. In the initial-load effect (the `summary === null && draft === null`
   guard), replace the pair `void repriceSummary(store)` +
   `void repriceDeps(store)` with `void repriceAll(store)`.
4. In the refresh button `onClick` (next to the `?` help button), replace
   the pair with `void repriceAll(store)`.

Keep the surrounding comments accurate. The debounced re-price comment
already says "the summary (the meter) and the deps panel re-fetch", which
still holds.

## Definition of Done

- `grep -n "repriceSummary\|repriceDeps" packages/client/src/Card.tsx`
  returns no matches.
- `pnpm build` type-checks (`tsc -b` clean).
- Committed with the message
  `refactor(client): route the Card reprice pairs through repriceAll`.
