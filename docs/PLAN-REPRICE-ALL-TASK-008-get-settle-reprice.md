# TASK-008: Route the `performGet` settle re-read through `repriceAll`

Pre-existing issue found in the TASK-004 review: `performGet`'s settle
path (`finish`) in `packages/client/src/store/deps.ts` re-implements the
summary re-read with a direct `fetchSummary` + dispatch instead of a
reprice helper, and on failure writes `note: ''` instead of the route's
message (a mild multiple-sources-of-truth).

Fix: replace `finish`'s re-read block
```ts
fetchSummary({ engine: draft.engine, config: draft.config })
  .then((summary) => store.dispatch({ type: 'summary/ack', summary }))
  .catch(() => store.dispatch({ type: 'summary/fail', note: '' }))
```
with
```ts
void repriceAll(store, { engine: draft.engine, config: draft.config })
```
(`repriceAll` is defined in this same file; no import change. The
`fetchSummary` import stays: `repriceSummary` above uses it.)

Reasoning and side-effect evaluation (the plan's all-call-sites
direction):
- A Get run builds and installs the engine's system dependencies, so the
  deps the panel prices can change with the run. Re-fetching both read
  models on the settle is the plan's direction.
- The re-fetch is one-shot per run settle (success, failure, or abort).
  Bounded.
- A transient deps probe failure clears the deps model (the established
  `repriceDeps` semantics); the panel returns on the next reprice.
- The summary note now carries the route's message on a re-read failure,
  consistent with every other reprice site (the old `note: ''` swallowed
  it).

Update the doc comments that name the summary re-read (the `performGet`
module doc's "the summary re-read hands the Logs section back to the
stored value" and the `finish` / `settleRun` comments) to name both read
models.

## Definition of Done

- `finish` uses `repriceAll`; no direct `fetchSummary` + dispatch re-read
  remains in `performGet`.
- The doc comments name both read models.
- `pnpm build` type-checks (`tsc -b` clean).
- Committed with the message
  `refactor(client): route the Get settle re-read through repriceAll`.
