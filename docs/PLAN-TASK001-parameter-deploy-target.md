# TASK 001 — Add the `ParameterDeploy` type and `deploy` field to `ParameterSpec`

**Phase:** 1 — Refactor: config-file deployment target
**Depends on:** none

## What

Add to `packages/core/src/parameter.ts`:

- A `ParameterDeploy` object-literal union:
  `{ target: 'cli' } | { target: 'env' } |
  { target: 'config'; format: 'json' | 'yaml' | 'env'; block?: string; key?: string }`.
- An optional `deploy?: ParameterDeploy` field on `ParameterSpec`.
- An optional `toConfig?: (value: unknown) => unknown` speller on
  `ParameterSpec` (the value to nest under the config key; absent means the raw
  value).

## Definition of Done

- `pnpm build` type-checks; the new fields are optional, so every existing spec
  (which carries no `deploy`) still compiles unchanged.
- The `ParameterDeploy` union is exported from the core index.
- A unit test in `packages/core` (or the providers test that imports the type)
  asserts a spec accepts a `config` deploy target with a `format`, `block`, and
  `key`, and that a `cli`/`env` target is accepted.
