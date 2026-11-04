# TASK-001: Diagnose and record both root causes

## Context

Basalt hangs and then fails when "engine default model" is selected in the
provider configuration. The launch log shows two distinct faults:

1. The Get step aborts with `!! /home/derek/.cache/huggingface/hub/basalt has
   local changes. Get aborted; commit or revert them first.`
2. The server exits with `the server needs --model and the engine binary: run it
   as basalt serve --config FILE (or --mock-engine)`.

## Work

Confirm and record both root causes in this file (a short "Diagnosis" section):

1. **Get abort.** The Basalt adapter's `deploy` step writes
   `basalt_config.json` into the engine directory
   (`~/.cache/huggingface/hub/basalt`), which is the git checkout of the basalt
   repo. The next Get step's `git status --short` reads the untracked
   `basalt_config.json` as a local change and aborts the sync. The relevant code
   is `packages/providers/src/engines/basalt/basaltAdapter.ts` (`renderLaunch`
   computes a relative `configPath` when no model directory is set; `deploy`
   joins it against `engineDir`) and
   `packages/providers/src/acquire.ts` (`syncEngineRepo` aborts on a dirty
   checkout).

2. **Missing `--model` / `--engine-bin`.** The launch argv is
   `bin/basalt serve --config basalt_config.json` with no `--model` and no
   `--engine-bin`. The basalt serve CLI
   (`~/.cache/huggingface/hub/basalt/serve/server.py`, `main`) requires both:
   `if not a.mock_engine and not (a.model and a.engine_bin): fail(...)`. When
   "engine default model" is selected, `config.model` is the registry key
   (`qwen38-flash-next`), and the deploy step downloads the default `.basalt`
   artifact, but the launch argv never spells the model path or the engine
   binary.

## Definition of Done

- This file carries a "Diagnosis" section naming both root causes with the
  exact code locations and the basalt serve CLI contract.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
