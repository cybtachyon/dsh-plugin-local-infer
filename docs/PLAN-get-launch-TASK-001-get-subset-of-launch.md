# TASK-001: Make Get a subset of the Launch code path

## Context

Today `getEngine` (`packages/ui/src/ops/engine.ts`) runs git sync, the dep
plan, the build, and the Infernix artifact downloads, but it does NOT run the
`hf download` of the selected model or the selected chat templates. Those live
in each adapter's `deploy` step (e.g. `basaltAdapter.deploy`), which only runs
on Launch. So "Get" is not a subset of "Launch": Launch does strictly more.

`launchEngine` persists its logs via `persistLaunchLogs`, which overwrites the
stored `lastLogs` with `--- Launching...\n${result.logs}`. When Launch runs the
Get steps first, that overwrite wipes the Get-step logs.

## Work

1. Introduce a shared Get-steps routine (a new exported function in
   `packages/ui/src/ops/engine.ts`, or a new `packages/ui/src/ops/get-steps.ts`)
   that runs, in order, streaming each step through the `log` sink:
   1. Install the engine's system dependencies for the host OS (the
      `runInstall` / `checkDeps` path, gated by `allowRunDeps`).
   2. Git clone the engine repo / download the engine binary
      (`syncEngineRepo` + the binary symlink, reusing `acquire.ts`).
   3. `docker compose pull` (compose engines) or the source build step
      (`buildEngineRepo`).
   4. `hf download` the selected model when it is not already present (reuse
      the HF download op; skip when present).
   5. `hf download` any selected chat templates when not already present.
   Each step is idempotent: a step that is already satisfied is skipped and
   logged as such.
2. Make `getEngine` a thin wrapper that calls the shared routine and streams to
   the log, returning the existing `GetOutcome`.
3. Make `launchEngine` call the shared Get-steps routine (idempotent) before
   rendering/running the launch plan, then launch. Preserve the Get-step logs:
   the launch's persisted logs must include the Get-step output it ran, not
   wipe it. Thread the Get logs into `persistLaunchLogs` (prepend/append) so the
   Logs section and the log file show the Get steps followed by the launch.
4. Keep the adapter `deploy` model-download step consistent with the shared
   routine (no duplicate download when Launch already ran the Get model
   download). Prefer the shared routine as the single source; the adapter's
   download becomes a no-op when the model is already present.

## Definition of Done

- `getEngine` and `launchEngine` both route through one shared Get-steps
  function; no Get step (deps, clone, build, model download, template download)
  is implemented in two places.
- `getEngine` now includes the model download and the chat-template download.
- A Launch that runs the Get steps preserves those logs in the persisted
  `lastLogs` and the log file (a new test asserts the launch output contains the
  Get-step lines).
- `pnpm build`, `pnpm test` (with coverage thresholds), and `pnpm lint` pass.
- New/updated Vitest tests cover: the shared routine runs all five steps;
  Launch preserves Get logs; an already-present model download is skipped.
