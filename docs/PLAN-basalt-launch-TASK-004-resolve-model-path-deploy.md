# TASK-004: Resolve the model artifact path in the deploy step

## Context

The `--model` flag the launch argv carries (TASK-003) is a placeholder the
deploy step resolves to the concrete artifact path after the model download. The
concrete path depends on the model download target layout:

- **Flat model directory** (a user override): `<modelDir>/<fileName>`.
- **Hub-cache layout** (the default):
  `~/.cache/huggingface/hub/models--{ns}--{name}/snapshots/{commit}/<fileName>`,
  where `{commit}` is only known after the download (the hf CLI writes the
  content-addressed `blobs/` plus a `snapshots/{commit}/` tree).

The deploy step already downloads the model artifact (the `existsSync` +
`hfDownloadCommand` block). It must then resolve the concrete path and thread it
into the spawn argv.

## Work

In `packages/providers/src/engines/basalt/basaltAdapter.ts`, `deploy`:

1. After the model download block, resolve the concrete model artifact path:
   - For the flat layout (`useHubCache` false): `join(baseDir, fileName)`.
   - For the hub-cache layout (`useHubCache` true): use
     `hubCacheSnapshotFilePath(baseDir, repoId, fileName)` (from core) to resolve
     the `snapshots/{commit}/<fileName>` path. The `repoId` is
     `repoIdFromUrl` of the default model entry's URL
     (`jesdga/Qwen3.8-Flash-Next-Basalt`).
2. Replace the `--model` placeholder in the spawn argv with the resolved path.
   The argv is `plan.argv` (a readonly array); build a new array with the
   `--model` value swapped for the resolved path before the `host.spawn` call.
   Keep the `--engine-bin` value as the build-tree binary path.
3. If the model artifact is absent and the download fails, the deploy step
   already returns `{ ok: false }`; keep that. If the snapshot path cannot be
   resolved (a download that left no snapshot), fail the deploy with a detail
   naming the missing artifact.

## Definition of Done

- `deploy` resolves the concrete model artifact path (flat `join` or hub-cache
  `hubCacheSnapshotFilePath`) after the model download and threads it into the
  spawn argv's `--model` value.
- The spawn argv carries `--model <concrete path>` and `--engine-bin <binary>`.
- A missing artifact (a failed download or an unresolvable snapshot) fails the
  deploy with a detail.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
