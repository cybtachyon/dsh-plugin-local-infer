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
before editing it, and use `mkdir -p` for the new homes. The user runs the
commands; do NOT execute the moves or the config.json edit yourself.
Verify only by read-only inspection of the live filesystem (and `bash -n`
syntax check of the drafted script). Deliver the command list in the final
user-facing response, and also include the steps that make the new code
live on this install: inspect how the plugin bundle is installed in the
active DSH profile (`ls ~/.dsh/profiles/*/node_modules` and the installed
bundle's package.json), then give the exact rebuild + reinstall +
host-restart commands for that install shape.

Definition of Done: commands drafted, `bash -n`-checked, and cross-checked
against the live filesystem state (every source path confirmed present or
explicitly guarded); expected state after the user runs them: engine
checkout at `~/.cache/dsh/infer/basalt`, config at
`~/.cache/dsh/infer/config/basalt/basalt_config.json`, no `basalt*` entries
under `~/.cache/huggingface/hub/` besides the `models--*` tree, snapshot dir
holds only `Qwen3.8-FN-NVFP4-DQ6_K.basalt` (+ repo files), config.json
`modelDirectory` blank per the questionnaire answer. Report the drafted
script and the reinstall steps in the task result (do not commit them as
files).

Depends on: TASK-008.

## Result (2026-11-05)

Drafted, `bash -n`- and shellcheck-clean script delivered in the task result
(not committed, per the Definition of Done). Cross-checked against the live
filesystem:

- Both basalt checkouts sit at the same commit (`cb02eb7`); the snapshot-dir
  clone holds the fresher build (bin at 15:55 vs 15:42), so it moves to
  `~/.cache/dsh/infer/basalt` and the hub copy is deleted as the superseded
  duplicate. Its `build/` is dropped (CMake cached the old absolute path);
  `bin/` relocates intact.
- The newest config is the hub copy (v2 models format, 16:20, 494 B); it
  moves to `~/.cache/dsh/infer/config/basalt/basalt_config.json`; the older
  snapshot copy (301 B) is removed.
- `config.json` edit (jq, guarded + timestamped backup, fixed-point
  idempotent, dry-run verified on a copy): blanks only the two
  `modelDirectory` values pinned into the hub cache (top-level `config` and
  the basalt provider). The explicit overrides stay: strata and hyperqwen
  `~/.dsh/models`, infernix and ninfer `~/src/hf-models`.
- Live basalt serve processes reference the old paths, so the script refuses
  to run while they live; the user stops the engine from the UI first.
- Activation: the profile install is a symlink
  (`~/.dsh/profiles/web/node_modules/dsh-plugin-local-infer` ->
  `/home/derek/src/dsh-plugin-local-infer`), so `pnpm build` plus a dsh host
  restart makes the new code live; no bundle reinstall step.
