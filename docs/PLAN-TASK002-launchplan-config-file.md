# TASK 002 — Add a `configFile` field to `LaunchPlan`

**Phase:** 1 — Refactor: config-file deployment target
**Depends on:** none

## What

Add to `packages/core/src/adapter.ts`:

- An optional `configFile?: { path: string; content: string }` field on
  `LaunchPlan`, carrying the rendered config file the deploy step writes and the
  engine's config flag points at.

## Definition of Done

- `pnpm build` type-checks; a plan without a `configFile` is unchanged.
- The field is exported with the rest of the `LaunchPlan` surface.
- A unit test asserts a `LaunchPlan` literal with a `configFile` compiles and a
  plan without one is accepted.
