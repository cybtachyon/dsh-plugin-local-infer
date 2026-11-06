# TASK-006: Engine config files land in ~/.cache/dsh/infer/config

In `packages/providers/src/engines/basalt/basaltAdapter.ts` `renderLaunch`,
the `basalt_config.json` path is
`join(modelDownloadTarget(modelDirectory).baseDir, BASALT_CONFIG_FILE)`,
which dirtied the HF hub cache and the model snapshot dir. Change the
placement to `join(dshConfigCacheDirectory(), this.id, BASALT_CONFIG_FILE)`
(TASK-001; Questionnaire answer #3: per-engine subdirectory, so Basalt's
file lands at `~/.cache/dsh/infer/config/basalt/basalt_config.json`).
Basalt takes the path via `--config`, so it carries no placement
requirement.

Keep the engine-required escape hatch explicit: the placement stays
adapter-computed inside `LaunchPlan.configFile.path`, so an engine that
requires a config in a specific directory can still stamp its own path.
Document that contract on the `configFile` field of `LaunchPlan` in
`packages/core/src/adapter.ts` (default home: the plugin config directory;
an adapter may override only when the engine requires it).

Ensure the parent directory exists before the write: check
`nodeLifecycleHost.writeFile` in `packages/providers/src/adapters.ts`; if it
does not `mkdir` recursively first, make `BasaltAdapter.writeConfigFile`
(or the host) create `dirname(path)`.

Audit the other adapters (`ninfer`, `infernix`, `llamacpp`, `strata`,
`hyperqwen`) for config-file writes; there should be none today, but record
any found and apply the same default home.

Update `packages/providers/tests/basalt.spec.ts` config-path assertions and
add: default launch writes the config under `~/.cache/dsh/infer/config`
(stub homedir), not the model directory.

Definition of Done: config file path correct on render + deploy; directory
created; contract documented; suites pass; providers `lib/` outputs
committed; prek clean; committed.

Depends on: TASK-001.
