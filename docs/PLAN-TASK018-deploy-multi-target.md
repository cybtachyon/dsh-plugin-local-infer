# TASK 018 — Extend the `deploy` target to support multiple targets

**Phase:** 5 — Deploy target refinements
**Depends on:** TASK 001, TASK 004, TASK 005

## Context

TASK 005 declared a single `deploy` target per spec. Strata's shared specs
carry both a `toArgv` spelling (the `strata launch` flag the binary and
source-build modes pass) and a `toEnv` spelling (the container variable the
docker mode passes). A single target could not express "both", so TASK 005
declared them `cli` to keep the binary path working. The consequence: the
Strata docker plan stopped carrying the shared-spec env vars
(`FAMILY`, `CONTEXT`, `VISION`, `PARALLEL`, `GPU`, `TUNE`, `API_KEY`,
`MODEL_PATH`), so the docker build mode is no longer a first-class operation
on par with the source/binary mode.

## What

- Change `ParameterSpec.deploy` (in `packages/core/src/parameter.ts`) to
  accept a single `DeployTarget` **or** a list of `DeployTarget`s. Keep the
  existing single-target shape so every migrated spec from TASK 005 still
  compiles unchanged (backward-compatible).
- Add a `deployTargets(spec)` normalizer to the shared adapter helpers
  (`packages/providers/src/adapters.ts`): it returns the spec's target list
  (a single target wrapped in a one-element list, a list passed through, and
  an empty list when `deploy` is absent).
- Update `flagsFromSpecs`, `envFromSpecs`, and `configFileFromSpecs` to key
  off the target list: a spec contributes to a helper when its target list
  contains that helper's target (`cli` → flags, `env` → env, `config` →
  config file). The un-migrated fallback (no `deploy` → read the
  `toArgv` / `toEnv` / `toConfig` presence) is unchanged.
- Migrate Strata's shared specs (`family`, `context`, `vision`, `parallel`,
  `gpu`, `tune`, `apiKey`, `modelPath`) to declare **both** `cli` and `env`.
  The `access` and `dataDir` specs stay `cli`-only; `port` stays `cli`.
- This makes both build modes first-class for Strata: the binary/source plan
  spells the flags (the `cli` target), and the docker plan carries the env
  vars (the `env` target).

## Definition of Done

- `pnpm build` type-checks; a single-target `deploy` (every spec from
  TASK 005) still compiles unchanged.
- The Strata docker plan carries the shared-spec env vars again, and the
  binary plan spells the flags. Both build modes are first-class.
- All existing provider tests pass unchanged.
- A new unit test in `packages/providers/tests/adapters.spec.ts` asserts a
  spec with a multi-target `deploy` (`cli` + `env`) contributes to both
  `flagsFromSpecs` and `envFromSpecs`, and that a single-target spec is
  unchanged.
- `pnpm test` clears the coverage thresholds in `vitest.config.ts`;
  `pnpm lint` is clean.
