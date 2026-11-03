# TASK 006 — Add a `deps` field to `EngineOsProfile`

**Phase:** 2 — Refactor: per-platform build dependencies
**Depends on:** none

## What

Add to `packages/providers/src/engines/engineOs.ts`:

- An optional `deps?: readonly SystemDep[]` field on `EngineOsProfile`, the
  build dependencies for that platform's local build (importing the `SystemDep`
  type from core).

## Definition of Done

- `pnpm build` type-checks; the field is optional, so every existing profile
  (which carries no `deps`) still compiles.
- A unit test asserts an `EngineOsProfile` literal with a `deps` array compiles.
