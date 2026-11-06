# TASK-003: renderLaunch renders the config v2 envelope and drops --model

## Goal

`BasaltAdapter.renderLaunch` writes the v2 file the 0.3.0 serve CLI accepts:

1. Render the blocks with `configFileFromSpecs(BASALT_PARAMETERS, config, 'json')`
   (which now yields `server` / `models[]` / `engine` from TASK-002), parse the
   result, and re-serialize as `{ version: BASALT_CONFIG_VERSION, models, engine,
   server }` (fixed key order; every block always has its defaults so all three
   are present).
2. Drop `--model` and its value from the serve argv. The argv becomes
   `[binaryPath, 'serve', '--config', configPath, '--engine-bin', binaryPath]`.
   `--engine-bin` stays (the CLI-only flag that pins the build-tree binary).
3. The model entry's `model` value keeps the same pre-download placeholder
   `join(baseDir, modelFile)` the old `--model` flag carried; TASK-004 swaps
   it for the concrete artifact path in deploy.
4. `plan.modelFile` / `plan.modelId` stamping is unchanged.

Update the module header, the class doc, and the inline comments (they all
describe the `--model` flag ride).

## Touch points

- `packages/providers/src/engines/basalt/basaltAdapter.ts`
- `packages/providers/tests/basalt.spec.ts`: the `renderLaunch` describe -
  argv assertions (no `--model`), config content assertions (v2 envelope,
  version stamp, entry carries the placeholder path).
- Rebuild `lib/` (`pnpm build`).

## Definition of Done

- renderLaunch specs green; `plan.configFile.content` parses to
  `{version: 2, models: [entry], engine, server}` with the placeholder in
  `entry.model`.
- Committed with the `lib/` outputs.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
