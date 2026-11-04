# PLAN: Add the orchestrator package

Add a new `orchestrator` package to the dsh-plugin-local-infer bundle that is
disabled by default, shows an "Orchestrator" settings card in the Web GUI when
its component is enabled, persists an editable "Orchestrator Prompt" whose
default comes from a shipped `prompt.md`, and injects the saved prompt into the
system prompt when enabled. Document the feature in README.md.

## Verification guidelines

- Repo commands are the gate: `pnpm build`, `pnpm test`, `pnpm test:coverage`
  (thresholds lines 90 / functions 93 / branches 78 / statements 90 in
  vitest.config.ts), and `pnpm lint`. Run `prek run --files <paths>` before
  each commit.
- The new package must land with its own vitest specs under
  `packages/orchestrator/tests/` so the coverage thresholds still pass.
- The bundle patch row for the new component must ship `disabled: true` so a
  fresh install has the component off; the GUI toggle then writes an enabling
  row override in the user's profile patch layer.
- Host-side changes only take effect after a host restart (or bundle
  off/on); a page refresh only picks up a rebuilt `dsh/client.js`. The profile
  install of this plugin symlinks the repo, so `pnpm build` plus a host
  restart activates host work.
- Commits must be path-scoped (`git add <paths>`). Do not stage files
  unrelated to the task in progress. (The working tree was observed dirty with
  pre-existing basalt lib edits at blueprint time; they were gone by commit
  time, so treat any unexpected dirty file as out of scope.)
- The lazy-CJS card bundle keeps exactly two runtime externals (`react`,
  `@deepseek-ai/dsh-client-ui-primitives`); guard every primitive use and the
  react require, per the existing card pattern.
- Client slot registrations must not displace the existing Engine settings
  card; verify both cards render after the orchestrator card registers.

## Open questions (all answered, 2026-11-04)

1. Persistence: A. A dedicated `~/.dsh/local-infer/orchestrator.json` owned by
   the orchestrator package.
2. Injection form: A. A global system-prompt section
   (`ctx.systemPrompt.section`).
3. prompt.md location: A. `packages/orchestrator/prompt.md`, shipped in the
   package's `files`, read at runtime relative to the package module.
4. Card slot: A. `plugins.bundle.config` only.
5. README scope: B. Both `README.md` and `docs/zh/README.md` (Chinese).

## Task dependencies

- TASK-001 (package scaffold) is the foundation for every other task.
- TASK-001b (basalt spec fix) is an interlude: it depends on nothing and
  unblocks the repo-wide test gates that every later task's Definition of
  Done relies on.
- TASK-002 (config + default prompt) depends on TASK-001.
- TASK-003 (system prompt injection) depends on TASK-002.
- TASK-004 (settings routes) depends on TASK-002.
- TASK-005 (refactor, host half) depends on TASK-001 through TASK-004.
- TASK-006 (patch rows + meta) depends on TASK-001.
- TASK-007 (client card) depends on TASK-004.
- TASK-008 (client rebuild) depends on TASK-007.
- TASK-009 (refactor, client half) depends on TASK-007 and TASK-008.
- TASK-010 (build/test/coverage/lint gate) depends on all preceding tasks.
- TASK-011 (README) depends on TASK-006 for the final component id and
  enablement wording.
- TASK-012 (activation walkthrough) depends on TASK-010 and TASK-011.

## Tasks

### Phase 1: Orchestrator host package

- [x] [TASK-001-package-scaffold](docs/PLAN-orchestrator-TASK-001-package-scaffold.md)
- [x] [TASK-001b-basalt-spec-fix](docs/PLAN-orchestrator-TASK-001b-basalt-spec-fix.md)
- [x] [TASK-002-config-and-default-prompt](docs/PLAN-orchestrator-TASK-002-config-and-default-prompt.md)
- [ ] [TASK-003-system-prompt-injection](docs/PLAN-orchestrator-TASK-003-system-prompt-injection.md)
- [ ] [TASK-004-settings-routes](docs/PLAN-orchestrator-TASK-004-settings-routes.md)
- [ ] [TASK-005-refactor-host-half](docs/PLAN-orchestrator-TASK-005-refactor-host-half.md)

### Phase 2: Bundle wiring (disabled by default)

- [ ] [TASK-006-patch-rows](docs/PLAN-orchestrator-TASK-006-patch-rows.md)

### Phase 3: Orchestrator browser card

- [ ] [TASK-007-client-card](docs/PLAN-orchestrator-TASK-007-client-card.md)
- [ ] [TASK-008-client-build](docs/PLAN-orchestrator-TASK-008-client-build.md)
- [ ] [TASK-009-refactor-client-half](docs/PLAN-orchestrator-TASK-009-refactor-client-half.md)

### Phase 4: Gates, docs, and activation

- [ ] [TASK-010-build-test-lint-gate](docs/PLAN-orchestrator-TASK-010-build-test-lint-gate.md)
- [ ] [TASK-011-readme](docs/PLAN-orchestrator-TASK-011-readme.md)
- [ ] [TASK-012-activation-walkthrough](docs/PLAN-orchestrator-TASK-012-activation-walkthrough.md)
