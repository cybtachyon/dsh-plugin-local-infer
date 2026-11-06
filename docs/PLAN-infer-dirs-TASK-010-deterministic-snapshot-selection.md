# TASK-010: Deterministic hub-cache snapshot selection

Pre-existing issue surfaced by TASK-001: `hubCacheSnapshotFilePath` in
`packages/core/src/models.ts` returns the first `readdirSync` entry under
`snapshots/` that holds the file. With multiple snapshot commits holding the
same file name (a repo re-downloaded at a new revision), the pick is
filesystem-order dependent, so the resolved model directory (TASK-002) and
the stamped artifact path can flip between the stale and the fresh
snapshot.

Make the selection deterministic and equal to what the hf CLI treats as
the active revision:

1. Read `refs/main` (the branch ref file the hf CLI writes) under the
   `models--{ns}--{name}` directory; when its content names a commit
   directory under `snapshots/` that holds the file, that snapshot wins.
2. Otherwise (no ref, or the ref's commit does not hold the file) pick the
   snapshot directory with the newest mtime.
3. Keep the null result when no snapshot holds the file.

Both `hfDownloadResultDirectory` (infer-cache.ts) and every caller of
`hubCacheSnapshotFilePath` (basalt/ninfer deploy artifact resolution, chat
template lookup) share this one rule; do not re-implement it per caller.

Tests in `packages/core/tests/models.spec.ts` (or the existing hub-cache
spec): two snapshot dirs holding the same file, ref points at the second
(ref wins over mtime), missing ref (newest mtime wins), ref names an absent
commit (mtime fallback), file in neither (null).

Definition of Done: deterministic rule + tests; suites green; core `lib/`
outputs committed; prek clean; committed.

Depends on: TASK-001. Blocks: TASK-002 (run first).
