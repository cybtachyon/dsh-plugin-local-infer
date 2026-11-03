# TASK 012 — Register Basalt across the provider registries

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 009, TASK 010, TASK 011

## What

- `packages/providers/src/engines.ts`: add a `basalt` `EngineInfo` entry
  (`supports: { docker: false, local: true }`, `parameters: BASALT_PARAMETERS`).
- `packages/providers/src/acquire.ts`: add `basalt` to `ENGINE_SOURCES` (repo
  `https://github.com/jesdga95/basalt`, branch `main`, build steps from
  `BASALT_LINUX`) and to `ENGINE_OS_PROFILES` (linux/macos/windows).
- `packages/providers/src/platform.ts`: add a `basalt` entry to
  `ENGINE_PLATFORM_DEFAULTS` (the CMake build command; no docker tag).
- `packages/providers/src/model-defaults.ts`: add a `basalt` `DefaultModel`
  entry (repo `jesdga/Qwen3.8-Flash-Next-Basalt`, file
  `Qwen3.8-FN-NVFP4-DQ6_K.basalt`).
- `packages/providers/src/index.ts`: import and register `BasaltAdapter` in
  `apply()`, and re-export `BASALT_PARAMETERS`.

## Definition of Done

- `pnpm build` type-checks.
- A unit test asserts `ENGINES` includes a `basalt` entry with
  `supports.local === true` and `supports.docker === false`, that
  `engineSource('basalt')` and `engineOsProfile('basalt', 'linux')` resolve, and
  that the provider `apply` registers a `basalt` adapter (a duplicate-id
  registration throws, so the registration is exercised).
