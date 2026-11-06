# TASK-011: Adapter deploy gates use the deterministic presence check

Dismissed item from TASK-007, promoted to a task. The four adapters'
deploy re-fetch gates (`ensureModelArtifact` in basalt, and the ninfer /
infernix / llamacpp equivalents) still gate on
`existsSync(modelArtifactPath(entry, baseDir, useHubCache))`, which under
the hub-cache layout only checks the per-repo `blobs` directory. A blob-only
cache (first download interrupted before snapshot links were written)
passes the gate, the deploy skips the re-download, and the later
`hubCacheSnapshotFilePath` lookup fails with a confusing "no hub-cache
snapshot after download" error.

Convert every adapter deploy gate to the TASK-007 core
`modelArtifactPresent` (and the chat-template gate to
`chatTemplatePresent` where adapters check templates): the gate asks
"does the resolved snapshot hold the file", so a blob-only cache triggers a
cheap re-download (the hf CLI reuses the blobs and writes the snapshot
links) instead of a dead end.

Tests in `packages/providers/tests/`: for basalt (and one other adapter if
its harness makes it cheap), a hub cache with a blob but no snapshot ⇒
deploy runs the hf download and then resolves the artifact path.

Definition of Done: no deploy path gates on a bare directory-exists check;
new test(s) pass; full suite, build, lint green; providers `lib/` outputs
committed; prek clean; committed.

Depends on: TASK-007. Blocks: TASK-008.
