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
 - [x] [TASK-005-record-spawn-argv](docs/PLAN-basalt-link-TASK-005-record-spawn-argv.md)
 - [x] [TASK-006-refactor-review](docs/PLAN-basalt-link-TASK-006-refactor-review.md)
 - [ ] [TASK-008-ninfer-spawn-argv](docs/PLAN-basalt-link-TASK-008-ninfer-spawn-argv.md)

### Phase 3: verification

 - [ ] [TASK-007-verify-commit](docs/PLAN-basalt-link-TASK-007-verify-commit.md)

## Task dependencies

- TASK-003 depends on TASK-001 (uses `portInArgv`).
- TASK-004 depends on nothing; TASK-005 touches the same adapter file, so
  run after TASK-003/TASK-004.
- TASK-006 reviews the Phase 1 + Phase 2 commits.
- TASK-008 (found by TASK-006) applies the same spawn-argv write-back to
  the ninfer adapter; run after TASK-006.
- TASK-007 runs after every implementation task (TASK-008 included).

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
- TASK-006 (refactor pass): resolved two risks in the reviewed code.
  `computeProviderStatuses` read "the provider names no model" from
  `provider.model === undefined` only, while the card passes a saved
  `config.model: ''` through and the tie side already treats an empty
  modelId as no tie; both sides now share the `namesNoModel` rule in
  core/status.ts. And the `BASALT_DEFAULT_MODEL_ID` extraction (19d841b)
  left the same literal keying basalt in `presets.ts` and `vram.ts`; both
  now read the constant.
- TASK-006 reviewed, no action: the `plan.argv` write-back is sound
  (planKey is engineId:port, the swap and resolve passes are idempotent,
  and `persistLaunchRecord` reads the same post-deploy plan object). The
  `ensureModelArtifact` synthetic entry's `modelId: 'basalt'` is an inert
  shape placeholder (the download helpers read url and file only).
- TASK-006 pre-existing, unfixed (outside the five commits):
  `NInferAdapter.deploy` spawns the `resolveLaunchArgv` result without
  writing it back onto the plan, so a Windows build-tree launch with an
  engineDirectory persists a record argv the process never carries (the
  D4 defect class; Linux and macOS bare names keep the records matching).

## Answers

- A1 (2026-11-04): Fix all four defects D1-D4, including the general
  `computeProviderStatuses` no-model rule.
- A2 (2026-11-04): No re-link loosening for pre-fix records. The user
  manually corrects the existing records on this machine; basalt is not
  publicly released, so no other user has a stale record. The D4 fix is
  forward-looking (new launches persist the real spawn argv).
