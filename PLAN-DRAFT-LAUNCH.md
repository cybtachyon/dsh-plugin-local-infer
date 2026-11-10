# Draft-aware Launch

Goal: while editing a provider in the client card, the Launch control runs the
launch process with the current **draft** settings (engine, config, platform,
Auto Rebuild) instead of the saved provider settings. The launch must not
update the saved provider settings: Save persists, Discard reverts. The client
submits the draft values to the launch endpoint through the route's existing
per-request override fields (settled below: no new host-side request shape).

## Verification guidelines

- Follow the repo gates in AGENTS.md (`pnpm build`, `pnpm test`,
  `pnpm test:coverage` thresholds, `pnpm lint`, `prek run --files ...`) at the
  final verification task.
- Host-side proof: a ui spec pins that a launch request's engine/config/
  platform/autoRebuild fields override the stored values and that a launch
  mutates only the target entry's launch record and the last-run logs.
- Client-side proof: client specs assert the POST body sent to
  `/local-infer/launch` while editing an existing provider carries the draft
  values (changed model/params/platform entry/autoRebuild) and the edited
  `providerId`, and that no `/local-infer/save` request fires from the launch
  click.
- Emitted `lib/` outputs land with `src/` changes (committed emit); stage an
  explicit file list (never `git add -A`).

## Questionnaire answers (2026-11-09)

1. Backend shape: **reuse the existing launch body fields** (`engine`,
   `config`, `platform`, `autoRebuild`); no new host-side `draft` request
   shape. TASK-01 pins the contract with specs only.
2. Control scope: **title-bar control only** while a provider form is open;
   collapsed-list row buttons keep launching stored values.
3. Draft vs dirty: **always submit the draft** while editing (an unedited
   draft equals the stored values).

## Phases and micro-tasks

### Phase 1 - Host: pin the launch override contract (specs only)

- [x] [TASK-01-host-contract-spec](docs/PLAN-DRAFT-LAUNCH-TASK-01-host-contract-spec.md) -
  Spec-pin request-field precedence and launch non-mutation of stored config.

### Phase 2 - Client: submit the draft on Launch while editing

- [x] [TASK-01b-basalt-spec-fix](docs/PLAN-DRAFT-LAUNCH-TASK-01b-basalt-spec-fix.md) -
  Unblock the test gate: sync `basalt.spec.ts` expectations with the
  `vram-reserve-mib` param (pre-existing red at HEAD).
- [x] [TASK-02-client-platform-shape](docs/PLAN-DRAFT-LAUNCH-TASK-02-client-platform-shape.md) -
  Fix the launch-body `platform` shape to the host's single per-engine entry.
- [ ] [TASK-03-entry-launch-draft](docs/PLAN-DRAFT-LAUNCH-TASK-03-entry-launch-draft.md) -
  `performEntryLaunch` takes an optional draft override; run key and re-price
  follow it.
- [ ] [TASK-04-card-routing-tests](docs/PLAN-DRAFT-LAUNCH-TASK-04-card-routing-tests.md) -
  Title-bar click passes the draft when editing; spec coverage.
- [ ] [TASK-05-refactor-client](docs/PLAN-DRAFT-LAUNCH-TASK-05-refactor-client.md) -
  Refactor pass over the client phase.

### Phase 3 - Verification

- [ ] [TASK-06-verify](docs/PLAN-DRAFT-LAUNCH-TASK-06-verify.md) -
  Full build, tests, coverage, lint, prek; commit emit.

## Task dependencies

- TASK-01 -> TASK-01b -> TASK-02 -> TASK-03 -> TASK-04 -> TASK-05 -> TASK-06

## Discovered pre-existing issues

- Launch/stop body `platform` shape mismatch: the client wraps the per-engine
  entry in `{ [engine]: entry }` but `parseStoredPlatformConfig` (host) reads
  ONE entry, so unsaved Engine Directory / Engine Fork edits silently never
  reach a launch today. Fixed by TASK-02 (client side).
- `packages/providers/tests/basalt.spec.ts` red at HEAD (4 tests, verified
  2026-11-09 with a stashed clean tree): 561b01c added the `vram-reserve-mib`
  parameter without updating the surface-order and engine-block render
  expectations. Fixed by TASK-01b (test expectations synced to the source
  surface; no src change).
- Commit ac397c3 shipped a `basaltWindows.ts` src change without its tracked
  `lib/` emit (stale committed emit at HEAD). Re-synced by the forced rebuild
  during TASK-01 and committed beside it.
