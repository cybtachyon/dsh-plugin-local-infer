# TASK 016 — Harden the node `spawn` against a missing `argv[0]`

**Phase:** 4 — Codebase quality and maintainability
**Depends on:** none

## What

`packages/providers/src/adapters.ts` `createNodeLifecycleHost().spawn` calls
`nodeSpawn(argv[0] ?? '', ...)`, which spawns an empty command when `argv` is
empty. Guard the empty-`argv` case so it reports a spawn error (settling the
handle's `onExit` with a detail) instead of spawning `''`.

## Definition of Done

- A unit test spawns an empty `argv` through the node host and asserts the
  handle settles with an error detail rather than spawning an empty command.
- All existing `adapters.spec.ts` tests pass.
