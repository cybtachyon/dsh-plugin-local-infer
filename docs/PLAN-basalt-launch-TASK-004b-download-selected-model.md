# TASK-004b: Download the selected model file, not always the engine default

## Context

TASK-003 introduced the `--model` placeholder, which `renderLaunch` computes
from `basaltModelFileName(config.model)`: a `.basalt` file name passes through,
a registry key maps to its artifact file, and a bare config falls back to
`BASALT_MODEL_FILE`. But the deploy step's model download block always downloads
`BASALT_MODEL_FILE` (the engine default) via a fixed `DefaultModel` entry. So a
user-selected custom `.basalt` file (a directory-scan selection) is pointed at by
the `--model` flag while the download fetches the default artifact. If the custom
file is not already on disk, the `--model` flag points at a missing file.

This is a pre-existing gap from TASK-003, out of TASK-004 scope.

## Work

In `packages/providers/src/engines/basalt/basaltAdapter.ts`, `deploy`:

1. Resolve the model file name the `--model` flag names, using the same rule
   `renderLaunch` uses (`basaltModelFileName` on `config.model`, falling back to
   `BASALT_MODEL_FILE`).
2. Make the model download block fetch that file name (set the `DefaultModel`
   entry's `file` field to the resolved name) instead of always
   `BASALT_MODEL_FILE`, so a user-selected custom `.basalt` file is downloaded
   into the model directory and the `--model` flag points at a file that exists.
3. The hub-cache snapshot resolution (TASK-004) must use the same resolved file
   name, so the concrete `--model` path matches the downloaded artifact.

## Definition of Done

- The deploy download block fetches the file named by `config.model` (resolved
  through the same rule as `renderLaunch`), falling back to `BASALT_MODEL_FILE`
  for a bare config.
- The hub-cache snapshot resolution uses the same resolved file name.
- A user-selected custom `.basalt` file is downloaded and the `--model` flag
  points at it.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
