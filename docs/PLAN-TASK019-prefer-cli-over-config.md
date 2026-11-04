# TASK 019 — Establish and document the "prefer CLI args over config writes" preference

**Phase:** 5 — Deploy target refinements
**Depends on:** TASK 018

## Context

With the multi-target `deploy` from TASK 018, a spec can declare both a `cli`
target and a `config` target (the shape the Basalt engine needs: a parameter
the engine accepts on the command line **and** in `basalt_config.json`). When
both are available, the plugin must pick one. Writing the value into the
engine's config file risks overwriting a customization the user made by hand
in that file. The CLI arg is the safer default: it is consumed for this
launch only and leaves the on-disk config file (and the user's edits to it)
untouched.

## What

- Add the preference to the user-facing docs, in the "Using the plugin"
  section of both `README.md` and `docs/zh/README.md`: when a parameter can
  be set both as a CLI arg and as a config-file write, the plugin defaults to
  the CLI arg, to avoid overwriting the user's engine customizations where
  possible. State the reason (protecting hand-edited engine config files).
- Apply the preference in the launch rendering: when a spec's target list
  contains **both** `cli` and `config`, the deploy step spells the CLI flag
  and skips the config-file write for that spec. The config file is written
  only for specs whose sole target is `config`. Encode this in
  `configFileFromSpecs` (in `packages/providers/src/adapters.ts`): a spec
  contributes a config-file entry only when it has a `config` target and no
  `cli` target.
- The `env` target is unaffected: a `cli` + `env` spec (Strata) still
  contributes to both the flags and the env map.

## Definition of Done

- The preference is documented in both `README.md` and `docs/zh/README.md`,
  with the note that it avoids overwriting user engine customizations where
  possible.
- `configFileFromSpecs` skips a spec that also carries a `cli` target, so a
  `cli` + `config` spec spells the CLI flag and does not write the config
  file; a `config`-only spec still writes the file.
- All existing provider tests pass unchanged.
- A new unit test in `packages/providers/tests/adapters.spec.ts` asserts a
  spec with both `cli` and `config` targets contributes to `flagsFromSpecs`
  but not to `configFileFromSpecs`, and that a `config`-only spec
  contributes to `configFileFromSpecs`.
- `pnpm test` clears the coverage thresholds in `vitest.config.ts`;
  `pnpm lint` is clean.
