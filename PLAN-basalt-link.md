# PLAN: basalt provider process linking

Fix: the basalt provider reads as "Unable to link to a provider" (unsure
banner with manual `kill` commands) even though the plugin launched the
engine itself, so the card offers no Stop. Make basalt providers link to
their processes (green status) and be stoppable from the card.

## Verified root cause (2026-11-04)

Live state on this host (provider `provider-mw1h7xsw-9yp5q9`, basalt, port
18020, config `{"vision":"dynamic","maxContext":262144,"port":18020}`):

- The spawned `basalt serve` launcher execs `python3 -m serve.server ...`
  (pid kept) which spawns the C++ `basalt` engine child.
- The bound port (18020) lives in `basalt_config.json` and appears in
  neither process command line.

Four stacked defects keep `providerStatuses` from ever reading `running`:

- **D1 port match**: `matchLaunchSignature` (packages/core/src/reserve.ts)
  requires `signature.port` as a standalone number in the command line.
  Basalt's port rides the config file, so no process ever matches the
  basalt signature.
- **D2 model tie**: `BasaltAdapter.renderLaunch` never stamps `plan.modelId`,
  so `launchedModels` (packages/service/src/index.ts) gets no entry and the
  re-link record carries no model: a matched engine can never be tied to a
  model.
- **D3 no-model provider**: the stored provider config names no model, and
  `computeProviderStatuses` (packages/core/src/status.ts) reads a
  no-model provider as unsure even when the plugin-launched engine on its
  exact port is tied to a model.
- **D4 record argv fidelity**: `deploy` spawns a rewritten argv (`--model`
  placeholder swapped for the hub-cache blob path, relative binary resolved
  by `resolveLaunchArgv`) but the plan keeps the placeholder, so the
  persisted launch record's argv never appears in the live command line and
  `reLinkRecord` reads the engine `foreign` after a host restart.

## Verification guidelines

Follow the repo gates in AGENTS.md (build, test, coverage thresholds, lint,
`prek run --files` before each commit). Tracked `lib/` outputs land with
their `src/` changes in the same commit. Definition of done for the whole
plan: `pnpm test`, `pnpm test:coverage`, `pnpm lint` all green; a provider
config like the live one above reads `running` when its basalt process
runs, and `stopped` (killable from the card) when stopped.

## Open questions (for the user)

- Q1: fix scope: all four defects D1-D4, including the general
  `computeProviderStatuses` rule change for no-model providers, or a
  basalt-only subset?
- Q2: the current live engine's stored record holds the placeholder
  `--model` path and is unrecoverable for re-link: relaunch the engine from
  the card after the fix is deployed (recommended), or loosen
  `commandMatchesArgv` to skip the `--model` token for old records?

## Task index

### Phase 1: core link contract

 - [x] [TASK-001-signature-port-match](docs/PLAN-basalt-link-TASK-001-signature-port-match.md)
 - [x] [TASK-002-nomodel-provider-status](docs/PLAN-basalt-link-TASK-002-nomodel-provider-status.md)

### Phase 2: basalt adapter

 - [x] [TASK-003-signature-port-in-config](docs/PLAN-basalt-link-TASK-003-signature-port-in-config.md)
 - [x] [TASK-004-plan-model-id](docs/PLAN-basalt-link-TASK-004-plan-model-id.md)
 - [ ] [TASK-005-record-spawn-argv](docs/PLAN-basalt-link-TASK-005-record-spawn-argv.md)
 - [ ] [TASK-006-refactor-review](docs/PLAN-basalt-link-TASK-006-refactor-review.md)

### Phase 3: verification

 - [ ] [TASK-007-verify-commit](docs/PLAN-basalt-link-TASK-007-verify-commit.md)

## Task dependencies

- TASK-003 depends on TASK-001 (uses `portInArgv`).
- TASK-004 depends on nothing; TASK-005 touches the same adapter file, so
  run after TASK-003/TASK-004.
- TASK-006 reviews the Phase 1 + Phase 2 commits.
- TASK-007 runs after every implementation task.

## Findings log

- TASK-001 (6599881): the change is split across 8611f21 (a parallel
  session's commit that carried an already-staged `portInArgv` hunk) and
  6599881; combined tree is per spec. No history reword wanted.
- Deliberate: `matchLaunchSignature`'s binary element stays a plain
  substring test. The substring behavior is what links Basalt at all (the
  serve launcher re-execs into `python3 -m serve.server`, where 'basalt'
  appears only inside paths). Overstating is fenced by the model tie: a
  marker-only match without a launched-models tie reads unsure, not
  running. Do not tighten binary matching to path-component/token form in
  the refactor pass.

## Answers

- A1 (2026-11-04): Fix all four defects D1-D4, including the general
  `computeProviderStatuses` no-model rule.
- A2 (2026-11-04): No re-link loosening for pre-fix records. The user
  manually corrects the existing records on this machine; basalt is not
  publicly released, so no other user has a stale record. The D4 fix is
  forward-looking (new launches persist the real spawn argv).
