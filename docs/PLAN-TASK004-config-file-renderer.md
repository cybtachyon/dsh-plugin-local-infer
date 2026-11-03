# TASK 004 — Add a config-file renderer to the shared adapter helpers

**Phase:** 1 — Refactor: config-file deployment target
**Depends on:** TASK 001

## What

Add to `packages/providers/src/adapters.ts`:

- `configFileFromSpecs(specs, config, format)` that collects every spec whose
  `deploy.target` is `'config'`, resolves each value (`toConfig(value) ?? value`,
  falling back to the spec default), nests it under `deploy.block` / `deploy.key`
  (defaulting the key to the spec key), and renders the result in the requested
  `format`: JSON (built-in `JSON.stringify`), `.env` (`KEY=VALUE` lines), and
  YAML (via a `yaml` package).
- Add `yaml` to the root `package.json` `devDependencies` (and the lockfile) for
  the YAML format.

## Definition of Done

- `pnpm build` type-checks and `yaml` is installed.
- A unit test in `packages/providers/tests/adapters.spec.ts` renders a spec
  surface with `server` and `engine` config blocks and asserts the nested JSON
  output matches `{ server: {...}, engine: {...} }`; a second test asserts the
  `.env` format emits flat `KEY=VALUE` lines; a third asserts the YAML format
  round-trips the same object.
- A spec with no `deploy` (or a non-`config` target) contributes nothing.
