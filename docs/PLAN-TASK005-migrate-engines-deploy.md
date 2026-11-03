# TASK 005 — Migrate every existing engine's `ParameterSpec` to declare `deploy`

**Phase:** 1 — Refactor: config-file deployment target
**Depends on:** TASK 001, TASK 004

## What

Update the parameter surfaces in
`packages/providers/src/engines/{ninfer,hyperqwen,llamacpp,infernix,strata}`:

- Declare `deploy` on every spec: `cli` for NInfer / llama.cpp / Infernix /
  Strata flag spellings, `env` for the Hyper-Qwen `.env` keys and the Strata
  docker `toEnv` spellings. Preserve every existing `toArgv` / `toEnv` spelling
  byte-for-byte.
- Update `flagsFromSpecs` and `envFromSpecs` in `packages/providers/src/adapters.ts`
  to key off `deploy.target` when present (falling back to the `toArgv` / `toEnv`
  presence when absent, so the migration is incremental).

## Definition of Done

- Every spec in every existing engine declares a `deploy` target.
- All existing provider tests pass unchanged (the spellings are preserved).
- A new unit test asserts every spec in `ENGINES` carries a `deploy` target, and
  that `flagsFromSpecs` / `envFromSpecs` still produce the same output as before
  for a representative config of each engine.
