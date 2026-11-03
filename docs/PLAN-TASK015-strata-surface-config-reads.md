# TASK 015 — Route the Strata adapter's inline config reads through the parameter surface

**Phase:** 4 — Codebase quality and maintainability
**Depends on:** TASK 005

## What

`packages/providers/src/engines/strata/strataAdapter.ts` `renderLaunch` reads
`config.family`, `config.vision`, and `config.context` inline with `typeof`
guards and hard-coded defaults (`'qwen'`, `'on'`), duplicating the defaults the
`STRATA_PARAMETERS` surface already declares. Route these reads through the
surface (a small `strataDefaults(config)` helper that resolves each key against
the spec `defaultValue`), so the defaults have one home.

## Definition of Done

- The inline `typeof` guards and hard-coded defaults are removed from
  `renderLaunch`; the values resolve from `STRATA_PARAMETERS`.
- The existing `strata.spec.ts` and `adapters.spec.ts` pass unchanged; a new
  assertion confirms the resolved defaults match the surface `defaultValue`s.
