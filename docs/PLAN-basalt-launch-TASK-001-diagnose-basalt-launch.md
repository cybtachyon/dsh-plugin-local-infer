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

## Diagnosis

Both faults are confirmed in the code and the basalt serve CLI.

### Fault 1: the Get step aborts on a dirty engine checkout

The deploy step writes `basalt_config.json` into the engine's git checkout,
which the next Get's `git status --short` reads as a local change and aborts
on.

- `packages/providers/src/engines/basalt/basaltAdapter.ts`, `renderLaunch`
  (lines 137-144): when `config.modelDirectory` is not a string (the "engine
  default model" selection carries no model directory), `configPath` is the
  bare `BASALT_CONFIG_FILE` (`basalt_config.json`), a relative path.
- `basaltAdapter.ts`, `deploy` (lines 248-253): a relative `configFile.path`
  is joined against `engineDir` (`join(engineDir, plan.configFile.path)`), so
  the file lands in `~/.cache/huggingface/hub/basalt`, the git checkout of the
  basalt repo.
- `packages/providers/src/acquire.ts`, `syncEngineRepo` (lines 297-309): for a
  present checkout it runs `git -C ${directory} status --short`; when the
  output is non-empty it logs
  `!! ${directory} has local changes. Get aborted; commit or revert them
  first.` and returns `{ ok: false, aborted: true, detail: 'the engine
  repository has local changes' }`. The untracked `basalt_config.json` is that
  non-empty output, so the Get step aborts.

### Fault 2: the launch argv is missing `--model` and `--engine-bin`

- `basaltAdapter.ts`, `renderLaunch` (line 158): the argv is
  `[binaryPath, 'serve', '--config', configPath]` -- three tokens, no
  `--model` and no `--engine-bin`. The settings ride the config file, and the
  config file's `server` block only carries a `model` key when the user named
  one (`basalt.ts`, the `model` spec, `deploy.block: 'server'`); with "engine
  default model" selected the `server` block has no `model`, so neither the
  config file nor the argv spells the model path or the engine binary.
- The basalt serve CLI requires both.
  `~/.cache/huggingface/hub/basalt/serve/server.py`, `main` (lines 108-109):
  `if not a.mock_engine and not (a.model and a.engine_bin): fail("the server
  needs --model and the engine binary: run it as basalt serve --config FILE
  (or --mock-engine)")`. `--engine-bin` is a hidden flag "set by `basalt
  serve`" (`serve/config.py` line 373), and `server.engine-bin` in the config
  file is rejected (line 109), so the model path and the engine binary must
  ride the launch argv, not the config file.

## Definition of Done

- This file carries a "Diagnosis" section naming both root causes with the
  exact code locations and the basalt serve CLI contract.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
