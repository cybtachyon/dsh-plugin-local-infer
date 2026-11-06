# TASK-003: Summary and deps view models stop backfilling the model dir

In `packages/ui/src/viewmodels/summary.ts` (`buildSummary`, around lines
218-232) the summary backfills `defaultModelDirectory()` (hub cache root)
into the `config` it renders, which makes a default install look overridden
(`useHubCache` false) and hands the card a hub-root `modelDirectory` that a
later Save stores as a real override. In
`packages/ui/src/viewmodels/deps.ts` (around line 80) the same default is
read.

Changes:

- Compute `useHubCache` from the RAW config `modelDirectory`
  (`isModelDirectoryOverridden(rawConfig.modelDirectory)`), never from the
  backfilled copy.
- Stop mutating `config` with the default: keep `config` as the raw config.
  The summary's displayed `modelDirectory` (the card's Model Directory
  field) becomes the resolved directory: the override when set, else the hf
  download result directory for the selected model (TASK-002's rule), else
  the hub cache root when nothing is cached yet. This is a display +
  presence-check value; it is not written back into the stored config.
- Model presence checks and `downloadCommand` rendering keep using
  `modelDir` + `useHubCache` exactly as today (the hub root is the base for
  the cache-layout joins).
- Check `packages/ui/src/viewmodels/deps.ts` and any other consumer of
  `defaultModelDirectory()` for the same backfill pattern and align them.
- Per Questionnaire answer #2, the resolved directory is NOT persisted into
  the stored config.

Update `packages/ui/tests/route.spec.ts` (summary assertions, e.g.
`summary.modelDirectory`, `downloadCommand` default vs override tests) and
add: with no override and a cached artifact, `summary.modelDirectory` is the
snapshot dir; with no override and nothing cached, it is the hub root; a
requested `config.modelDirectory` still wins.

Definition of Done: no backfill remains; view models display the resolved
directory; suites pass; ui `lib/` outputs committed; prek clean; committed.

Depends on: TASK-002.
