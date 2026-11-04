# TASK-002: Write the config file into the model download target directory

## Context

The Basalt adapter's `deploy` step writes `basalt_config.json` into the engine
directory (`~/.cache/huggingface/hub/basalt`), which is the git checkout of the
basalt repo. The next Get step's `git status --short` reads the untracked
`basalt_config.json` as a local change and aborts the sync
(`!! ... has local changes. Get aborted; commit or revert them first.`).

The config file must land in the model download target directory (the hub-cache
root for the default layout, the user model directory for an override), never in
the engine git checkout.

## Work

In `packages/providers/src/engines/basalt/basaltAdapter.ts`:

1. In `renderLaunch`, resolve the model download target base directory with
   `modelDownloadTarget(modelDirectory)` (already imported) and compute
   `configPath` as `join(baseDir, BASALT_CONFIG_FILE)`, so the config path is
   always absolute (the hub-cache root for the default layout, the user model
   directory for an override). Drop the relative `BASALT_CONFIG_FILE` fallback.
2. In `deploy`, write the config file to the (now absolute) `plan.configFile.path`
   as-is. The existing `isAbsolute` / `engineDir` join logic that lands a
   relative path in the engine directory is no longer needed for the default
   layout; keep it only if a relative path can still occur (it cannot after
   step 1, so simplify).
3. The spawn's `--config` flag now points at an absolute path in the model
   download target directory, so the engine reads the config from there, not
   from the engine checkout.

## Definition of Done

- `renderLaunch` computes `configPath` from `modelDownloadTarget(modelDirectory)`
  base directory, so the config file lands in the hub-cache root (default) or the
  user model directory (override), never the engine git checkout.
- `deploy` writes the config file to the absolute `plan.configFile.path`.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
