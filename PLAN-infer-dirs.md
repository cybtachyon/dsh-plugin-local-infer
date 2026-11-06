# PLAN-infer-dirs: Correct provider model / engine / config directory handling

Objective: give `dsh-plugin-local-infer` one sane directory model.

1. No default model download directory set: the model directory is the
   Hugging Face CLI download path result, i.e. the hub-cache snapshot
   directory holding the selected artifact (e.g.
   `/home/derek/.cache/huggingface/hub/models--jesdga--Qwen3.8-Flash-Next-Basalt/snapshots/21b8357546172bf19a685ccf3353e7da7aeadde0`
   for `Qwen3.8-FN-NVFP4-DQ6_K`). The hub cache stays the hf CLI download
   home (no `--local-dir`); "model directory" names where the artifact
   actually lands.
2. No engine download directory set: the engine checkout is
   `${HOME}/.cache/dsh/infer/<name>` (e.g. `/home/derek/.cache/dsh/infer/basalt`),
   never a subfolder of the model directory.
3. Config files in use (today: Basalt's `basalt_config.json`) land in
   `${HOME}/.cache/dsh/infer/config` unless the engine requires a specific
   placement.
4. Deliverable: a series of bash commands that correct the current install,
   which has models, engines, and config files scattered across `$HOME`
   (`~/.cache/huggingface/hub/basalt`, `~/.cache/huggingface/hub/basalt_config.json`,
   a stray `basalt/` clone and `basalt_config.json` inside the model
   snapshot dir).

## Verification guidelines

Follow AGENTS.md (single source of truth, not duplicated here). Additional
invariants specific to this plan:

- `pnpm build` emits tracked `lib/` outputs; they land in the same commit as
  their `src/` change, normalized by `scripts/build-format.mjs`. Delete stale
  `packages/*/tsconfig.tsbuildinfo` when a `git clean` removed outputs.
- Every directory rule has exactly one home in code (the Phase 1 core
  module); adapters, routes, and view models consume it, they never restate
  a `${HOME}/.cache/...` literal.
- The hub-cache layout flag (`useHubCache`) is computed from the RAW config
  `modelDirectory` only. A summary must never backfill the default directory
  into the config it hands downstream (that backfill is what materialized
  fake overrides and scattered the install).
- `prek run --files <paths>` before every commit.

## Open questions (answered in the Questionnaire section below)

1. Does `${model-name}` in the engine directory formula mean the engine id
   (e.g. `basalt`) or a per-model checkout folder? The example
   `~/.cache/dsh/infer/basalt` names the engine id.
2. After the hf download result is resolved, should the snapshot directory
   be persisted into the stored `config.modelDirectory`, or derived on every
   read and only displayed?
3. Config-file layout inside `~/.cache/dsh/infer/config`: one flat file
   (`config/basalt_config.json`) or a per-engine subdirectory
   (`config/basalt/basalt_config.json`)?
4. Migration: blank the current `modelDirectory` override in
   `~/.dsh/local-infer/config.json` so the new derived default applies, or
   keep it pointing at the snapshot directory?

## Questionnaire answers (2026-11-05)

1. Engine dir name: **engine id**. Default checkout is
   `~/.cache/dsh/infer/<engine-id>` (e.g. `basalt`). One checkout per engine.
2. Model dir persistence: **derive, never persist**. The hf-download-result
   snapshot directory is resolved on every read and displayed; it is never
   written back into `config.modelDirectory`.
3. Config layout: **per-engine subdirectory**. Basalt's file lands at
   `~/.cache/dsh/infer/config/basalt/basalt_config.json`.
4. Migration: **blank it**. The migration removes the pinned
   `modelDirectory` (top-level config and providers entries that pin it to
   the snapshot dir) so the derived default applies; explicit user-chosen
   overrides (strata `~/.dsh/models`, infernix `~/src/hf-models`) stay.

## Task index

### Phase 1 - Core foundation

 - [x] [TASK-001-core-infer-cache-paths](docs/PLAN-infer-dirs-TASK-001-core-infer-cache-paths.md)
 - [x] [TASK-010-deterministic-snapshot-selection](docs/PLAN-infer-dirs-TASK-010-deterministic-snapshot-selection.md)

### Phase 2 - Model directory from the hf download result

 - [x] [TASK-002-model-dir-hf-result](docs/PLAN-infer-dirs-TASK-002-model-dir-hf-result.md)
 - [ ] [TASK-003-summary-deps-no-backfill](docs/PLAN-infer-dirs-TASK-003-summary-deps-no-backfill.md)
 - [ ] [TASK-004-hf-download-target](docs/PLAN-infer-dirs-TASK-004-hf-download-target.md)

### Phase 3 - Engine directory default

 - [ ] [TASK-005-engine-dir-default](docs/PLAN-infer-dirs-TASK-005-engine-dir-default.md)

### Phase 4 - Config file placement

 - [ ] [TASK-006-config-file-placement](docs/PLAN-infer-dirs-TASK-006-config-file-placement.md)

### Phase 5 - Quality gates

 - [ ] [TASK-007-refactor-directory-resolution](docs/PLAN-infer-dirs-TASK-007-refactor-directory-resolution.md)
 - [ ] [TASK-008-full-verification-gate](docs/PLAN-infer-dirs-TASK-008-full-verification-gate.md)

### Phase 6 - Migration deliverable

 - [ ] [TASK-009-migration-commands](docs/PLAN-infer-dirs-TASK-009-migration-commands.md)

## Task dependencies

- TASK-001 blocks TASK-010, TASK-005, TASK-006.
- TASK-010 (inserted from the TASK-001 review; deterministic snapshot pick)
  blocks TASK-002 and runs immediately after TASK-001.
- TASK-002 blocks TASK-003, TASK-004.
- TASK-003 blocks TASK-004 (shared route.spec expectations).
- TASK-004, TASK-005, TASK-006 block TASK-007.
- TASK-007 blocks TASK-008; TASK-008 blocks TASK-009.
- Questionnaire answers are recorded here and in the affected task files
  before those tasks run.
