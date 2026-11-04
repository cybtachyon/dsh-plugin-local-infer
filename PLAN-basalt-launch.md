# PLAN: Fix the Basalt "engine default model" launch failure

## Objective

Basalt hangs and then fails when "engine default model" is selected in the
provider configuration. The launch log shows two distinct faults:

1. The Get step aborts with `!! /home/derek/.cache/huggingface/hub/basalt has
   local changes. Get aborted; commit or revert them first.` because the deploy
   step writes `basalt_config.json` into the engine's git checkout
   (`~/.cache/huggingface/hub/basalt`), which the next Get's `git status --short`
   reads as a local change.
2. The server exits with `the server needs --model and the engine binary: run it
   as basalt serve --config FILE (or --mock-engine)` because the launch argv is
   `bin/basalt serve --config basalt_config.json` with no `--model` and no
   `--engine-bin`, both of which the basalt serve CLI requires.

The fix makes the deploy step write the config file into the model download
target directory (the hub-cache root or a user model directory, never the engine
git checkout) and makes the launch argv carry `--model <path>` and
`--engine-bin <binary>`, with the model path resolved after the model download
so the hub-cache snapshot commit is known.

## Verification guidelines

- A launch of a Basalt provider with "engine default model" selected must not
  abort the Get step on a dirty engine checkout.
- The launch argv must carry `--model <path>` and `--engine-bin <binary>`; the
  basalt serve CLI must not report `the server needs --model and the engine
  binary`.
- The `basalt_config.json` file must land in the model download target
  directory (the hub-cache root for the default layout, the user model directory
  for an override), never in the engine git checkout.
- `pnpm build`, `pnpm test`, and `pnpm lint` must pass.

## Open questions

(none; the diagnosis is complete and the fix is determined by the basalt serve
CLI contract and the existing model-download-target rule)

## Task dependencies

- TASK-002 (config path) depends on TASK-001 (diagnosis).
- TASK-003 (argv flags) depends on TASK-001 (diagnosis).
- TASK-004 (model path resolution) depends on TASK-003 (argv flags).
- TASK-004b (download selected model) depends on TASK-004 (model path resolution).
- TASK-005 (refactor) depends on TASK-002, TASK-003, TASK-004, TASK-004b (the fix commits).
- TASK-006 (tests) depends on TASK-004 (model path resolution).
- TASK-007 (build/test/lint) depends on TASK-006 (tests).

## Tasks

### Phase 1: Diagnosis

- [x] [TASK-001-diagnose-basalt-launch](docs/PLAN-basalt-launch-TASK-001-diagnose-basalt-launch.md)

### Phase 2: Fix

- [x] [TASK-002-config-path-model-dir](docs/PLAN-basalt-launch-TASK-002-config-path-model-dir.md)
- [x] [TASK-003-add-model-engine-bin-flags](docs/PLAN-basalt-launch-TASK-003-add-model-engine-bin-flags.md)
- [x] [TASK-004-resolve-model-path-deploy](docs/PLAN-basalt-launch-TASK-004-resolve-model-path-deploy.md)
- [x] [TASK-004b-download-selected-model](docs/PLAN-basalt-launch-TASK-004b-download-selected-model.md)

### Phase 3: Refactor

- [ ] [TASK-005-refactor-basalt-fix](docs/PLAN-basalt-launch-TASK-005-refactor-basalt-fix.md)

### Phase 4: Tests and verification

- [ ] [TASK-006-update-basalt-tests](docs/PLAN-basalt-launch-TASK-006-update-basalt-tests.md)
- [ ] [TASK-007-build-test-lint](docs/PLAN-basalt-launch-TASK-007-build-test-lint.md)
