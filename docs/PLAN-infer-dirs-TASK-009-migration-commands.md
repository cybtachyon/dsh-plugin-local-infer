# TASK-009: Migration commands for the current scattered install

Produce the exact series of bash commands that correct this machine's
install under the new directory rules. Inspect the live state first (do not
trust this list blindly):

- `~/.cache/huggingface/hub/basalt/` — the basalt engine checkout in the HF
  hub cache → move to `~/.cache/dsh/infer/basalt/`.
- `~/.cache/huggingface/hub/basalt_config.json` → move to
  `~/.cache/dsh/infer/config/basalt/basalt_config.json`.
- `~/.cache/huggingface/hub/models--jesdga--Qwen3.8-Flash-Next-Basalt/snapshots/21b8357546172bf19a685ccf3353e7da7aeadde0/basalt/`
  — a stray engine clone inside the model snapshot → move to
  `~/.cache/dsh/infer/basalt/` (replace whichever is not the built one;
  keep the checkout that has a `build/` or `bin/` output).
- `.../snapshots/21b8357.../basalt_config.json` — stray config inside the
  snapshot → move to `~/.cache/dsh/infer/config/basalt/` (it may be the fresher
  copy; keep the newest).
- `~/.dsh/local-infer/config.json`: per Questionnaire answer #4, blank the
  `modelDirectory` key (top-level `config` and every `providers[].config`)
  so the derived hf-download-result default applies; keep the explicit
  `engineDirectory` overrides for ninfer (`~/src/ninfer`) and infernix
  (`~/src/infernix`) and the explicit user-chosen `modelDirectory` overrides
  of the strata/infernix provider entries untouched.
- Leave untouched: `models--*` hub-cache trees (correct model homes),
  `~/.dsh/local-infer/logs`, `~/.dsh/models`, `~/src/hf-models`.

Requirements for the delivered commands: idempotent (safe to re-run),
guarded (test -e before each move), back up `config.json` with a timestamp
before editing it, and use `mkdir -p` for the new homes. Deliver the command
list in the final user-facing response (and in a short `docs/` note if
useful).

Definition of Done: commands verified by running the guarded idempotent
migration on this machine; final on-disk state: engine checkout at
`~/.cache/dsh/infer/basalt`, config at
`~/.cache/dsh/infer/config/basalt/basalt_config.json`, no `basalt*` entries under
`~/.cache/huggingface/hub/` besides the `models--*` tree, snapshot dir holds
only `Qwen3.8-FN-NVFP4-DQ6_K.basalt` (+ repo files), config.json modelDirectory
per the questionnaire answer.

Depends on: TASK-008.
