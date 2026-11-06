# TASK-004: deploy resolves the model artifact inside the config file

## Goal

The v2 server starts with `basalt serve --config <file> --engine-bin <bin>`
only. The concrete artifact path (the hub-cache snapshot path, or the flat
`--local-dir` join) lands in the config file's `models[0].model` entry instead
of the `--model` argv flag.

1. Replace `withModelArgv` with a config-content swap: parse
   `plan.configFile.content`, set `models[0].model = artifact.path`, and
   re-serialize (`JSON.stringify(..., null, 2)`) for `writeConfigFile`.
2. A plan whose configFile is missing or does not parse as a v2 envelope (a
   hand-built test plan) is written as-is; no crash.
3. Write the swapped content back onto `plan.configFile.content` alongside the
   existing spawn-argv write-back, so the plan reflects what was written.

## Touch points

- `packages/providers/src/engines/basalt/basaltAdapter.ts`
- `packages/providers/tests/basalt.spec.ts`: the `deploy` describe - the spawn
  argv no longer carries `--model`; the recorded `writeFile` content's
  `models[0].model` is the concrete artifact path (flat layout and seeded
  hub-cache snapshot layout); the argv + config write-back test is updated.
- Rebuild `lib/` (`pnpm build`).

## Definition of Done

- deploy specs green: order sequence (build, download, write, spawn) preserved;
  the seeded hub-cache case asserts the snapshot path inside the written
  config, not in argv.
- Committed with the `lib/` outputs.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
