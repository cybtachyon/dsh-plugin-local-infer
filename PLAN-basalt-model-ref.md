# PLAN: basalt register served-model fix

Fix: clicking "Register" for the `basalt` engine publishes model id `basalt`
(provider `basalt-local-basalt`), an id the engine never serves, so the model
404s until the user manually Fetch Models. The basalt serve server advertises
its `Service.model` on `/v1/models`, which comes from the `.basalt` artifact's
`meta.name`: `Qwen3.8-Flash-Next NVIDIA-NVFP4` (verified in the engine's
`serve/server.py` + `serve/engine/modelfile.py` and in the artifact downloaded
on this host). `BasaltAdapter.modelRef` must publish that served id, the same
pattern ninfer, infernix, and llamacpp already follow (artifact map -> served
alias).

## Root cause pointers

- `packages/providers/src/engines/basalt/basaltAdapter.ts` `modelRef()`:
  returns the raw `config.model` value (registry key or `.basalt` path) or
  `{ id: 'basalt', name: 'Basalt' }` for a bare config. None of these ids is
  served by the engine except a `.basalt` file name, which only matches
  because the engine also accepts the artifact's own file name.
- The engine accepts requests whose model is in `served_names()` =
  `[meta.name, artifact file name]`, and `/v1/models` lists only `meta.name`.
- Registrar (`packages/core/src/registrar.ts`) writes `modelId = row.id` and
  `providerId = providerIdFor('basalt', row.id, 'local')`; the row comes from
  `resolveModelRow` (`packages/ui/src/ops/model.ts`) which prefers
  `discoverModel` then `modelRef`.

## Verification guidelines

- Unit-test the seam directly: `vitest run packages/providers/tests/basalt.spec.ts`.
- Full gates per AGENTS.md: `pnpm build`, `pnpm test`, `pnpm lint`,
  `prek run --files <paths>` before commit; tracked `lib/` outputs land with
  the `src/` change.
- Manual spot check is not possible on this host without a Blackwell card;
  the tests are the gate.

## Open questions (answers to be recorded here)

- Q1: For a `config.model` that names a custom `.basalt` file (directory-scan
  pick, not the bundled artifact), what should Register publish?
  Recommended: the file's basename, since the engine's `served_names()`
  accepts the artifact file name, so chat routing works without parsing the
  artifact's `meta.name`.
  Answer: 2026-11-04 — Publish the file basename (recommended option). The
  engine's `served_names()` accepts the artifact file name, so chat routing
  works for any `.basalt` pick.
- Q2: A profile that already carries the wrong `basalt-local-basalt` entry:
  add code to clean it up, or leave removal to the settings editor?
  Recommended: leave it (no migration code); the fixed Register writes the
  correct entry and the stale row is removable in Settings.
  Answer: 2026-11-04 — No migration code (recommended option). The stale
  entry is removed by hand in the Harness settings.

## Micro-tasks

Ordered list; dependency: TASK-002 depends on TASK-001 (it gates and commits
its output). No other cross-task dependencies.

### Phase 1 — Served-model resolution

- [x] TASK-001 — providers: publish the basalt served model id on register.
  Add `BASALT_SERVED_MODEL_ID = 'Qwen3.8-Flash-Next NVIDIA-NVFP4'` to
  `packages/providers/src/engines/basalt/basalt.ts` with a doc comment naming
  its provenance (the `.basalt` artifact `meta.name` the serve server
  advertises on `/v1/models`). Rewrite `BasaltAdapter.modelRef` to resolve:
  bare config, registry key `qwen38-flash-next`, and the bundled artifact file
  name all map to the served id; any other `.basalt` value publishes its
  basename (accepted by the engine's `served_names()`). Update the
  `BasaltAdapter model data` test block in
  `packages/providers/tests/basalt.spec.ts` to the new expectations and add a
  case for the registry key.
  DoD: `vitest run packages/providers/tests/basalt.spec.ts` green; typecheck
  clean.

### Phase 2 — Gates and commit

- TASK-002 — repo gates green and committed.
  DoD: `pnpm build`, `pnpm test`, `pnpm lint` clean; tracked `lib/` artifacts
  updated beside `src/`; `prek run --files` passes on the changed paths; one
  commit on top of `55ae3a7`.

## Refactor injection

Not applicable: single-file behavior fix plus its data constant; the change
follows the existing ninfer/infernix/llamacpp artifact-alias pattern and adds
no duplication worth a refactor pass.
