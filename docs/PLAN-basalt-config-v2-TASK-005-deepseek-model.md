# TASK-005: Register DeepSeek-V4.1-Flash as Basalt's second model

## Goal

The v0.3.0 engine is multi-model; the card offers a second Basalt model.
Basalt v0.3.0 release notes: pack `DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt`
on `jesdga/DeepSeek-V4.1-Flash-1017-Basalt`.

### Constants (`packages/providers/src/engines/basalt/basalt.ts`)

- `BASALT_DEEPSEEK_MODEL_REPO = 'jesdga/DeepSeek-V4.1-Flash-1017-Basalt'`
- `BASALT_DEEPSEEK_MODEL_FILE = 'DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt'`
- `BASALT_DEEPSEEK_MODEL_ID = 'deepseek-v41-flash'` (registry key)
- `BASALT_DEEPSEEK_SERVED_MODEL_ID = 'DeepSeek-V4.1-Flash'` (API alias)
- `basaltServedName(modelValue: string): string` - the single source of the
  API name an artifact answers to: the bundled Qwen artifact maps to
  `BASALT_SERVED_MODEL_ID`, the DeepSeek artifact to
  `BASALT_DEEPSEEK_SERVED_MODEL_ID`, any other artifact file to its basename
  (the engine also accepts the file name; today's rule).

### Model entry alias (`basaltAdapter.ts`)

`renderLaunch` stamps `alias: basaltServedName(...)` into the single model
entry. Upstream `models.md`: the entry's `alias` is the name the API reports
and `/v1/models` lists; without one the server reports the artifact's stored
`meta.name`, which the plugin cannot know for arbitrary packs. `modelRef`
returns exactly `basaltServedName(...)` (it computes the same value today for
the bundled artifact and custom files, so published ids do not change; the
DeepSeek artifact publishes `DeepSeek-V4.1-Flash` instead of an unknown
`meta.name`).

### Per-artifact download repo (`basaltAdapter.ts`)

`ensureModelArtifact` builds its `DefaultModel` from the hardcoded Qwen repo
constants. Resolve the entry from the default model list instead
(`defaultModelFor('basalt', plan.modelId)`, else the
`defaultModelsForEngine('basalt')` entry whose `file` basename matches, else
the Qwen fallback pair) so the DeepSeek artifact downloads from its own repo.
The presence check and hub-cache snapshot lookup already take the url, so
threading the resolved entry carries them along.

### Data rows

- `model-defaults.ts`: second `basalt` entry (`deepseek-v41-flash`,
  label `Basalt DeepSeek-V4.1-Flash (UD-IQ1_M)`, repo url + file above).
- `vram.ts`: second estimated VramModel, id `deepseek-v41-flash`,
  `nativeMaxContext: 1048576` (release notes cap), `kvBytesPerToken` with the
  `fp16` term only (the pack has no KV format choice), `source: 'estimated'`.
  Derive conservative figures from the public pack facts (510 GB native
  checkpoint; UD-IQ1_M dense weights; a MoE with a large engram table read
  from RAM/file), and write the arithmetic into the doc comment the way the
  Qwen entry does.
- `presets.ts`: second wildcard preset for `deepseek-v41-flash` (values:
  `maxContext: 32768` only; no `kv`, the model has no choice). Keep the Qwen
  preset the `isDefault` row.

### Tests (`packages/providers/tests/basalt.spec.ts`)

- Surface key order unchanged; registration: two default models, ids, repos,
  files; VRAM list now two estimated rows; preset list two rows (only the
  Qwen one default).
- `renderLaunch`/`modelRef`: DeepSeek selection renders an entry with
  `model` = its artifact placeholder, `alias` = `DeepSeek-V4.1-Flash`;
  `modelRef` publishes it; the Qwen rows keep today's served id (alias
  equals the current name, so nothing user-visible moves).
- `deploy` with a seeded DeepSeek-hub-cache or a failing-run assertion that
  the `hf download` command names the DeepSeek repo and file (mirror the
  existing flat-layout ordering test).

## Definition of Done

- basalt.spec.ts green including the new rows; `pnpm build` emits updated
  `lib/`.
- Committed with the `lib/` outputs.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
