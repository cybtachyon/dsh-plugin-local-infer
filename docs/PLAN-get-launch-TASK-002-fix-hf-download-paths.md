# TASK-002: Fix the HF download paths to the real hub-cache layout

## Context

`hfHubCacheDirectory()` (`packages/core/src/hf-cache.ts`) resolves to
`$HOME/.cache/huggingface/hub` (or `HF_HUB_CACHE` / `$HF_HOME/hub`). The
download command (`hfDownloadCommand` in `packages/core/src/models.ts`) appends
`--local-dir ${directory}`, so a download lands flat in the hub root
(`hub/basalt/...`), NOT in the real hub-cache layout. The real layout that
`hf download` (without `--local-dir`) produces is:

```
hub/models--{namespace}--{Model-Name}/blobs/<sha256>
hub/models--{namespace}--{Model-Name}/snapshots/<commit>/<file>
hub/models--{namespace}--{Model-Name}/refs/
```

The presence check (`modelArtifactPath`) and the dropdown scan
(`modelEntriesForEngine`) both assume the flat layout and do not cover Basalt
(`.basalt`) or Strata (`.gguf`/`.safetensors`).

## Answers applied

- **HF layout:** drop `--local-dir` (hub-cache layout) **only when the model
  directory is not overridden**. When the user overrides the Model Directory,
  keep `--local-dir` pointed at that dir (flat). The Model Directory field
  default is the hub cache.
- **Existing artifacts:** clean up the flat `hub/basalt/` dir and prune the
  stuck 102GB `.incomplete` blob (a one-time cleanup, recorded in TASK-005).

## Work

1. Make the model download target the hub-cache layout when the model directory
   is the default (not user-overridden): drop `--local-dir` so `hf download`
   writes into `hub/models--{ns}--{name}/` (content-addressed `blobs/` +
   `snapshots/`). When the Model Directory is overridden, keep `--local-dir`
   pointed at that dir (flat). The Model Directory field default becomes the
   hub cache; the per-model path is derived as
   `hub/models--{ns}--{name}/blobs/`.
2. Update `hfDownloadCommand` (and the chat-template command, and every
   provider/adapter that builds an `hf download` line, e.g.
   `basaltAdapter.deploy`) to use the cache layout instead of a flat
   `--local-dir`.
3. Update the presence check (`modelArtifactPath` and the summary's
   `modelStatus`/`chatTemplateStatus`) to resolve into the cache layout
   (`models--{ns}--{name}/blobs/` or `snapshots/`).
4. Add a cache scan that matches the `models--*` pattern against the models
   already present in the hub cache, and expose it to the per-provider model
   dropdown. List only the artifact types each engine serves:
   - Basalt: `.basalt`
   - NInfer: `.ninfer`
   - Infernix: `.ninfer` / `.infernix`
   - llama.cpp: `.gguf`
   - Hyper-Qwen: repo dirs holding a `.safetensors`
   - Strata: `.gguf` / `.safetensors`
   (extend `modelEntriesForEngine` or add a cache-aware variant; wire it into
   `buildSummary.modelFiles`.)

## Definition of Done

- `hfDownloadCommand` (and the adapter download lines) produce a cache-layout
  command (no flat `--local-dir` into the hub root); the per-model path is
  `hub/models--{ns}--{name}/blobs/`.
- The presence check resolves into the cache layout.
- The per-provider model dropdown lists the engine's own artifact types matched
  against `models--*` dirs in the cache (Basalt `.basalt`, NInfer `.ninfer`,
  Strata `.gguf`/`.safetensors`, etc.); an engine with no matching cached model
  lists none.
- `pnpm build`, `pnpm test` (with coverage thresholds), and `pnpm lint` pass.
- New/updated Vitest tests cover: the cache-layout command string, the
  presence path, and the per-engine artifact filtering (including Basalt and
  Strata).
