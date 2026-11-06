# TASK-001: Core infer-cache path module

Add the single source of truth for the plugin's infer cache locations and
for the "hf download path result" model directory, in
`packages/core/src/infer-cache.ts`, exported through
`packages/core/src/index.ts`.

Functions (names may be tuned to the file's naming style):

- `dshInferCacheDirectory(): string` — `${HOME}/.cache/dsh/infer`
  (`join(homedir(), '.cache', 'dsh', 'infer')`).
- `dshEngineCacheDirectory(engineId: string): string` —
  `join(dshInferCacheDirectory(), engineId)`. The default checkout home for
  every engine (e.g. `~/.cache/dsh/infer/basalt`).
- `dshConfigCacheDirectory(): string` —
  `join(dshInferCacheDirectory(), 'config')`. The default home for engine
  config files the plugin writes.
- `hfDownloadResultDirectory(hubCache: string, repoId: string, file: string): string | null`
  — the directory the hf CLI's download of `repoId`/`file` lands in with the
  hub-cache layout: the snapshot directory holding the file, resolved
  through the existing `hubCacheSnapshotFilePath` in
  `packages/core/src/models.ts`. Returns null when the artifact is not in
  the cache (the caller falls back to the hub cache root as the download
  base).

Do not change any call site in this task; later phases consume these.
Add unit tests in `packages/core/tests/` covering: the three path builders
against a stubbed home/env, and `hfDownloadResultDirectory` for a present
snapshot file and a missing one.

Definition of Done: new module + exports, `packages/core` builds, new tests
pass under `pnpm test packages/core` (vitest), tracked `lib/` outputs of
core are committed with the src change, `prek run --files` clean, committed.

Depends on: nothing (first task).
