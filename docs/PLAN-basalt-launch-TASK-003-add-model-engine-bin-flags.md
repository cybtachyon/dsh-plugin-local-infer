# TASK-003: Add `--model` and `--engine-bin` to the launch argv

## Context

The basalt serve CLI (`serve/server.py`, `main`) requires both `--model` and
`--engine-bin`:

```python
if not a.mock_engine and not (a.model and a.engine_bin):
    fail("the server needs --model and the engine binary: run it as basalt serve --config FILE (or --mock-engine)")
```

The current launch argv is `bin/basalt serve --config basalt_config.json` with
neither flag, so the server exits immediately after printing the legend.

## Work

In `packages/providers/src/engines/basalt/basaltAdapter.ts`, `renderLaunch`:

1. Resolve the model file name from `config.model`:
   - `config.model` carries either a registry key (a default-model selection,
     e.g. `qwen38-flash-next`) or an artifact file name (a directory-scan
     selection, e.g. `Qwen3.8-FN-NVFP4-DQ6_K.basalt`).
   - Map a registry key to its artifact file name through
     `defaultModelsForEngine('basalt')` (the `file` field); a value that is
     already a file name (ends in `.basalt`) passes through.
   - When `config.model` is absent (a bare config), fall back to the engine's
     default artifact file name (`BASALT_MODEL_FILE`).
2. Add `--model <modelPath>` and `--engine-bin <binaryPath>` to the launch
   argv, so the plan reads
   `[binaryPath, 'serve', '--config', configPath, '--model', <modelPath>, '--engine-bin', binaryPath]`.
   - `<modelPath>` is a placeholder the deploy step resolves to the concrete
     artifact path after the model download (see TASK-004). For the flat model
     directory layout it is `join(baseDir, fileName)`; for the hub-cache layout
     it is the snapshot path the deploy step resolves.
   - `<binaryPath>` is the same `binaryPath` the argv's first token carries
     (the build-tree `bin/basalt`), so the serve CLI spawns the engine binary it
     already names.
3. Keep the `configFile` block (the settings ride the config file, never the
   argv). The `--model` and `--engine-bin` flags are the only argv additions.

## Definition of Done

- `renderLaunch` spells `--model <modelPath>` and `--engine-bin <binaryPath>` in
  the launch argv, with `<modelPath>` a placeholder the deploy step resolves and
  `<binaryPath>` the build-tree engine binary.
- The model file name is resolved from `config.model` (registry key or file name)
  with a fallback to `BASALT_MODEL_FILE`.
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
