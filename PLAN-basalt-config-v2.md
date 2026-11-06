# Basalt config v2 support for Basalt v0.3.0

Basalt v0.3.0 (https://github.com/jesdga95/basalt/releases/tag/v0.3.0, flagged in
issue #239) replaced the single-model config with the v2 shape and the plugin's
launch breaks against it: `basalt serve --config ... --model ...` now errors
(`--model and --alias are set in a model entry`), and a config file without a
top-level `models` array is refused (`Basalt requires v2 config, please
upgrade`). Update the Basalt engine provider to render and launch config v2.

## Config v2 facts (from `serve/config.py` and `tools/migrations/config_v1_to_v2.py` at tag v0.3.0)

- The file shape is `{"version": 2, "server": {...}, "engine": {...}, "models": [{...}]}`.
  No other top-level keys; `models` is a non-empty list and each entry carries
  `model` (a path, resolved relative to the config file; absolute paths pass
  through).
- `--model` and `--alias` must not ride the serve CLI together with `--config`;
  the model path lands in `models[0].model`.
- `--engine-bin` remains a serve CLI option (hidden, CLI-only, refused inside
  the config file).
- Model-entry options (entry or top-level `engine`): `gpu`, `vision`,
  `parallel`, `slot-full-context`, `idle-sleep`, `idle-unload`,
  `min-free-vram-mib`, `fit-max-tokens`, `grammar`, the sampling defaults;
  plus `model` and `alias` (entry only). The migration script also moves
  `kv` and `max-context` into the entry.
- The `server` block keeps only what the whole server shares (`host`, `port`,
  `allowed-host`, `cors-origin`, `image-url-host`, `image-dir`,
  `image-remote-only`, `lazy`, `open`, `debug`, `request-lines`).
- Top-level `engine` keeps the shared engine flags: `expert-cache`, `prefill`,
  `resident-experts`, `spec`, ...

Re-blocked provider surface:

| spec key | v1 block | v2 placement |
| --- | --- | --- |
| port, host | server | server |
| gpu, parallel, vision, model | server | `models[]` entry |
| maxContext (key `max-context`) | engine | `models[]` entry |
| kv | engine | engine (see note) |
| expertCache, prefill, residentExperts, spec | engine | engine |

`kv` stays in the top-level `engine` block, unlike the upstream migration
script's default. `models.md`: a flag the model lacks stops the start in a
model entry but is silently left out for that model in the top-level `engine`.
DeepSeek-V4.1-Flash has no KV-format choice, so `kv` in its entry stops the
start while `kv` in `engine` only Flash-Next receives. One declarative surface
serves both models.

Each model entry also carries `alias`: the deterministic API name. Without
one the server reports the `meta.name` stored in the artifact, which is not
known to the plugin for every pack. The adapter stamps the same
`basaltServedName(config)` string the registrar's `modelRef` publishes, so
`/v1/models` always lists what DSH routes to.

## DeepSeek-V4.1-Flash registration (user-approved scope)

- Pack: `jesdga/DeepSeek-V4.1-Flash-1017-Basalt`, file
  `DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt` (release notes).
- Registry key `deepseek-v41-flash`; alias/served id
  `DeepSeek-V4.1-Flash`.
- `kv` is the model's one unknown-argument gap handled by the engine-block
  placement; `vision` sidecar modes (`cpu`, a GPU number) are unsupported for
  it (only `off`/`dynamic`), surfaced by the engine's own start check.
- `ensureModelArtifact` must resolve the download repo per artifact through
  the default model list (it hardcodes the Qwen repo today).
- Second estimated VramModel (`nativeMaxContext` 1048576, fp16-only KV term)
  and a second wildcard preset (no `kv` value).

## Verification guidelines

- Run `pnpm build` after `src/` changes so the tracked `lib/` outputs land with
  them, and delete stale `packages/*/tsconfig.tsbuildinfo` if `tsc -b` reports
  "up to date" over missing outputs.
- Gate every task on the touched package's vitest specs; gate the plan on
  `pnpm test`, `pnpm test:coverage` (thresholds in `vitest.config.ts`), and
  `pnpm lint`. Run `prek run --files <paths>` before each commit.
- Upstream ground truth is tag `v0.3.0` of jesdga95/basalt:
  `serve/config.py`, `docs/configuration/models.md`,
  `tools/migrations/config_v1_to_v2.py`.

## Open questions for the user

1. Version strategy: render config v2 only (the deploy step auto-rebuilds the
   engine checkout, which moves it to 0.3.x where v1 files are refused), or
   detect the installed engine version and render v1 or v2 accordingly?
2. `--engine-bin`: keep passing it on the serve argv (still accepted; pins the
   build-tree binary), or drop it and let `basalt serve` set it itself?
3. Scope: config v2 plumbing only, or also register the new
   DeepSeek-V4.1-Flash `.basalt` pack as a second default model (model list,
   VRAM model, presets) in this pass?

## Micro-tasks

### Phase 1 - shared config renderer

 - [x] [TASK-001-array-entry-block](docs/PLAN-basalt-config-v2-TASK-001-array-entry-block.md)
       Extend `configFileFromSpecs` (and the `ParameterDeploy` docs) with the
       `name[]` block convention: specs whose config `block` ends in `[]` merge
       their keys into the single object of a one-element array named by the
       prefix.

### Phase 2 - Basalt data surface

 - [x] [TASK-002-reblock-parameters](docs/PLAN-basalt-config-v2-TASK-002-reblock-parameters.md)
       Re-block `BASALT_PARAMETERS` per the table above, add the
       `BASALT_CONFIG_VERSION = 2` constant, refresh the surface doc comments,
       and update the parameter-surface specs in `basalt.spec.ts`.

### Phase 3 - adapter launch and deploy

 - [x] [TASK-003-render-v2-plan](docs/PLAN-basalt-config-v2-TASK-003-render-v2-plan.md)
       `renderLaunch` renders the `{version, models, engine, server}` envelope
       (entry `model` carries the pre-download placeholder path) and drops the
       `--model` flag from the serve argv.
 - [x] [TASK-004-deploy-model-in-config](docs/PLAN-basalt-config-v2-TASK-004-deploy-model-in-config.md)
       `deploy` resolves the downloaded artifact path into the config file's
       `models[0].model` (replacing the placeholder) instead of into the argv,
       replacing `withModelArgv`.

### Phase 4 - the second model

 - [x] [TASK-005-deepseek-model](docs/PLAN-basalt-config-v2-TASK-005-deepseek-model.md)
       Register DeepSeek-V4.1-Flash: default model entry, constants, alias
       stamping through a single `basaltServedName` source shared by the entry
       and `modelRef`, per-artifact repo resolution in `ensureModelArtifact`,
       estimated VramModel, wildcard preset.

### Phase 5 - review and gates

 - [ ] [TASK-006-refactor-review](docs/PLAN-basalt-config-v2-TASK-006-refactor-review.md)
       Refactor review of the Phase 1-4 commits.
 - [ ] [TASK-007-full-gate](docs/PLAN-basalt-config-v2-TASK-007-full-gate.md)
       Full repo gate: build, tests, coverage thresholds, lint, prek.

## Task dependencies

- TASK-001 blocks TASK-002 (the surface data uses the new convention).
- TASK-002 blocks TASK-003 (renderLaunch stamps the version and the entry
  placeholder from the re-blocked surface).
- TASK-003 blocks TASK-004 (deploy swaps the placeholder TASK-003 introduces).
- TASK-004 blocks TASK-005 (the alias stamp edits renderLaunch's entry).
- TASK-005 blocks TASK-006 blocks TASK-007.

## Answers

1. Version strategy: **v2 only**. 0.3.0 refuses v1 files and deploy
   auto-rebuilds the checkout to main (0.3.x), so no v1 fallback.
2. `--engine-bin`: **keep** passing it on the serve argv (CLI-only, still
   accepted; pins the build-tree binary).
3. Scope: **also register DeepSeek-V4.1-Flash** (default model list, estimated
   VRAM model, preset) in this pass.
