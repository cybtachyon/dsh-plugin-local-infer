# TASK-003: Convert the `providers.ts` reprice sites to `repriceAll`

File: `packages/client/src/store/providers.ts`

Convert the one-shot summary-only sites to `repriceAll`:

1. The entry-launch settle (after the launch stream settles to
   healthy / downloading / failed, the status-dot repaint):
   `void repriceSummary(store, { engine: provider.engine, config: provider.config })`
   becomes
   `void repriceAll(store, { engine: provider.engine, config: provider.config })`.
2. `performDraftLaunch` (after a healthy launch ack): same conversion with
   the draft's engine and config.
3. `performDraftStop` (after a successful stop): same conversion.

Keep the import as
`import { repriceAll, repriceSummary } from './deps.ts'`: one site stays
summary-only.

Do not convert the `performEntryStop` fast-poll
(`void repriceSummary(store)` inside `pollFn`). It re-fires every
`STOP_POLL_MS` (1000 ms) for up to 10 seconds, and the deps route re-probes
the host on every fetch. Converting it to `repriceAll` would add up to ten
live deps probes per stop with no UI benefit: stopping an engine does not
change the system dependencies the panel prices. Add a one-line comment at
that site naming this reason (the poll repaints the status dot only, so it
stays summary-only).

Widen the doc comments that say "re-fetches the summary" at the converted
sites to name the two read models.

## Definition of Done

- The three one-shot sites use `repriceAll`.
- The `performEntryStop` poll keeps `repriceSummary` with the new comment.
- `grep -n "repriceDeps" packages/client/src/store/providers.ts` returns no
  matches (the file never imported it).
- `pnpm build` type-checks (`tsc -b` clean).
- Committed with the message
  `refactor(client): route the providers reprice sites through repriceAll`.
