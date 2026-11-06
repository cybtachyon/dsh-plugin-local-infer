# TASK-005: Engine directory defaults to ~/.cache/dsh/infer/<engine-id>

In `packages/ui/src/ops/get-steps.ts`, `resolveEngineDirectory` falls back to
`join(modelDir, engineId)`, which cloned engines into the HF hub cache
(`~/.cache/huggingface/hub/basalt`). Change the fallback to
`dshEngineCacheDirectory(engineId)` (TASK-001). The Engine Directory
override in `StoredPlatformConfig` still wins.

Follow-through:

- `registerLaunchPlatform` in `packages/ui/src/ops/engine.ts` resolves the
  default and registers it with the service registry so deploys spawn with
  a real cwd. Keep that behavior, but per Questionnaire answer #1 the
  default is engine-keyed; verify the resolved default is only registered
  in memory and is never written back into the stored `platform` map (audit
  the save route and the summary `platform` echo; `packages/ui/tests/route.spec.ts`
  expects `engineDirectory: join(MODEL_DIR, 'ninfer')` somewhere around
  line 1406, adjust to the new rule and, if the resolved default leaks into
  storage anywhere, stop the leak).
- Update the client help text `engineDirHelp` in
  `packages/client/src/text.ts` (both locales): with no override the
  checkout lands in `~/.cache/dsh/infer/<engine>` instead of "under the
  model directory". Rebuild `dsh/client.js` via `pnpm build`.
- Update README.md where it documents the default engine/model directory
  placement.

Update affected tests (get-steps / route.spec engine-dir assertions, e.g.
the `engine clone` step logs and the summary platform echo).

Definition of Done: default checkout home is `~/.cache/dsh/infer/<engine-id>`
on every route and deploy path; no default ever persists to config.json;
help text + README match; suites pass; `lib/` + `dsh/client.js` outputs
committed; prek clean; committed.

Depends on: TASK-001.
