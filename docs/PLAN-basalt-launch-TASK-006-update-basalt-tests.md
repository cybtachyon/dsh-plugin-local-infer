# TASK-006: Update and extend the Basalt adapter tests

## Context

The Basalt fix (TASK-002, TASK-003, TASK-004) changes the launch argv (adds
`--model` and `--engine-bin`), the config file path (lands in the model download
target directory, not the engine checkout), and the deploy step's model path
resolution. The existing tests in `packages/providers/tests/basalt.spec.ts`
assert the old argv shape (`bin/basalt serve --config ...` with three tokens) and
the old config path (written into the engine directory). They must be updated,
and new tests added for the model path resolution.

## Work

In `packages/providers/tests/basalt.spec.ts` (and any other spec that asserts the
Basalt argv or config path):

1. Update the argv assertions to expect
   `[binaryPath, 'serve', '--config', configPath, '--model', <modelPath>, '--engine-bin', binaryPath]`.
2. Update the config-path assertions: the config file lands in the model download
   target directory (the hub-cache root for the default layout, the user model
   directory for an override), not the engine directory.
3. Add tests for the model path resolution:
   - A flat model directory layout resolves `--model` to `join(modelDir, fileName)`.
   - A hub-cache layout resolves `--model` to the
     `snapshots/{commit}/<fileName>` path (stub the snapshot directory).
   - A bare config (no `config.model`) falls back to `BASALT_MODEL_FILE`.
   - A registry-key `config.model` maps to its artifact file name.
4. Add a test that the config file no longer lands in the engine directory (the
   Get step's dirty-check scenario): after a deploy with the default layout, the
   engine directory carries no `basalt_config.json`.

## Definition of Done

- The Basalt spec assertions match the new argv and config-path behavior.
- New tests cover the model path resolution (flat, hub-cache, bare config,
  registry key) and the no-config-in-engine-directory rule.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
