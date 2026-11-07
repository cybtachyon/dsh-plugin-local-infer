# PLAN-AUTOREBUILD-PERSIST

Objective: fix the "Auto Rebuild" client checkbox so its value persists with each
provider configuration, an unchecked value reliably skips the Get/Rebuild portions
of a Launch (git sync, source build, docker image pull, binary installer) and only
spawns the engine (docker container or locally compiled binary) with the plan's
parameters, and a newly created provider starts unchecked while existing providers
keep their current behavior.

## Confirmed defects (from code inspection, 2026-11-06)

1. `autoRebuild` lives only in card UI state (`packages/client/src/store/types.ts`,
   `initialCardState` seeds `true`), so every save/reload resets it. It is never
   persisted with a provider.
2. `performEntryLaunch` (the provider-list Launch control,
   `packages/client/src/store/providers.ts`) sends no `autoRebuild` at all, so a
   saved-provider launch always runs the sync/build steps regardless of the box.
3. The docker deploy branches always run `docker pull` (`ninferAdapter.ts` ~331,
   `llamacppAdapter.ts` ~257, `strataAdapter.ts` ~347) and the Strata binary plan
   always runs `STRATA_BINARY_INSTALL` (~373) even when `autoRebuild === false`.
   The process-engine git sync guards (`options?.autoRebuild !== false`) already
   work.
4. `runSyncBuildStep` skips sync+build when the request flag is false
   (`packages/ui/src/ops/get-steps.ts:245`); the model and chat-template download
   steps still run when the artifact is absent (idempotent artifact fetch).

## Verification guidelines

- `pnpm build` (tsc -b + client bundle), `pnpm test`, `pnpm test:coverage`
  (thresholds in `vitest.config.ts`), `pnpm lint`, `prek run --files <paths>`
  before each commit.
- Tracked `lib/` outputs and `dsh/client.js` land in the same commit as their
  `src/` change (delete stale `packages/*/tsconfig.tsbuildinfo` if `tsc -b`
  reports "up to date" over missing outputs).
- Host-side routes/ops are verified by tests here; live activation needs a dsh
  restart (repo-symlinked profile install).

## Questionnaire answers (2026-11-06)

- Q1 Existing providers (no stored key): **treat as OFF / unchecked.** The stored
  file is still never rewritten by an upgrade (leave existing ones alone), but a
  missing key reads as unchecked in the form and as `false` on the entry launch
  body, so an existing provider skips rebuilds like a new one until the box is
  checked and saved.
- Q2 Skip scope: **git sync, source build, `docker pull` (NInfer, llama.cpp,
  Strata docker plans) and the Strata binary installer** all skip when the flag
  is false. Launch spawns the already-present image/binary with the plan's
  parameters only; a missing image or binary fails with its own spawn error.
- Q3 **Keep** the idempotent model / chat-template artifact downloads (they fetch
  only when the artifact is absent).
- Server note: a launch request with **no** `autoRebuild` key (CLI, legacy
  client) keeps today's full-run behavior. Only an explicit `false` skips. The
  card always sends an explicit boolean for provider and draft launches.

## Micro-tasks

### Phase 1 - Server: per-provider persistence

- [x] [TASK-001-provider-schema](docs/PLAN-AUTOREBUILD-PERSIST-TASK-001-provider-schema.md) -
  `StoredProviderConfig.autoRebuild?: boolean` in `packages/ui/src/config.ts` with
  boolean-sanitizing parse in `parseProviders`. DoD: round-trip read/write tests
  in `packages/ui/tests` (absent stays absent, non-boolean dropped).
- [ ] [TASK-002-save-route](docs/PLAN-AUTOREBUILD-PERSIST-TASK-002-save-route.md) -
  save route persists the body's `autoRebuild` onto the upserted entry; absent
  body key carries the existing entry's value over; settings-only save untouched.
  DoD: save-route tests for the three upsert paths.
- [ ] [TASK-003-summary-readmodel](docs/PLAN-AUTOREBUILD-PERSIST-TASK-003-summary-readmodel.md) -
  `ProviderSummaryEntry.autoRebuild?: boolean` carried in `buildSummary`.
  DoD: summary viewmodel test shows the stored value per entry.

Depends: 002, 003 -> 001.

### Phase 2 - Server: launch-time skip completeness

- [ ] [TASK-004-deploy-acquisition-skip](docs/PLAN-AUTOREBUILD-PERSIST-TASK-004-deploy-acquisition-skip.md) -
  guard `docker pull` (ninfer, llamacpp, strata) and the Strata binary installer
  with `options?.autoRebuild !== false`; spawn proceeds with the plan's argv.
  DoD: per-adapter tests (pull/install skipped, spawn still runs expected argv).
- [ ] [TASK-005-launch-chain-pin](docs/PLAN-AUTOREBUILD-PERSIST-TASK-005-launch-chain-pin.md) -
  pin the full chain: launch request `autoRebuild: false` -> Get steps emit the
  skip line, `localInfer.launch` receives `autoRebuild: false`, deploy spawns the
  plan's expected parameters with no sync/build/pull. DoD: ui launch-route test.

Depends: 005 -> 004.

### Phase 3 - Client: per-provider checkbox

- [ ] [TASK-006-store-move](docs/PLAN-AUTOREBUILD-PERSIST-TASK-006-store-move.md) -
  move the flag from `CardUiState` to `CardDraft` (rides `cachedDraft`, discard,
  and the summaryAck merge); `editProvider` loads `provider.autoRebuild ?? false`
  (a missing stored key reads as unchecked per Q1); new/seeded drafts read as
  unchecked; `draftLaunchBody` sends the draft value; `performEntryLaunch` sends
  `provider.autoRebuild ?? false`; `performSave` sends the draft value. DoD:
  store tests for load/save/launch bodies and defaults.
- [ ] [TASK-007-card-checkbox](docs/PLAN-AUTOREBUILD-PERSIST-TASK-007-card-checkbox.md) -
  the card's checkbox renders from the draft and dispatches `draft/edit`;
  `SaveRequest` gains `autoRebuild`. DoD: card render test toggles per-draft
  value, source pins updated.
- [ ] [TASK-008-client-tests](docs/PLAN-AUTOREBUILD-PERSIST-TASK-008-client-tests.md) -
  update `useCardStore.spec.ts`, `card.spec.ts`, `client.spec.ts` pins; add
  per-provider persistence regression (save then reload keeps the stored value;
  an entry without the key renders unchecked and launches with
  `autoRebuild: false`). DoD: suite green.

Depends: 006 -> 003 (read model field), 007 -> 006, 008 -> 007.

### Phase 4 - Whole-repo gates

- [ ] [TASK-009-gates](docs/PLAN-AUTOREBUILD-PERSIST-TASK-009-gates.md) -
  `pnpm build`, `pnpm test`, `pnpm test:coverage`, `pnpm lint` all green;
  tracked `lib/` + `dsh/client.js` emitted and committed. DoD: commands quoted
  with passing output.
- [ ] [TASK-010-refactor](docs/PLAN-AUTOREBUILD-PERSIST-TASK-010-refactor.md) -
  refactor review of the phase commits (see task file for the code-risk block).

Depends: 010 -> 009.
