# TASK-004: Update and extend the tests

## Context

The Basalt serve-dep fix (TASK-001) and the early-exit health poll (TASK-002,
TASK-003) change the `basaltPip` dep's probe/install commands and the
`pollHealth` behavior. The existing tests must be updated, and new tests added
for the early-exit path.

## Work

1. In `packages/providers/tests/deps.spec.ts` (or the spec that asserts the
   `basaltPip` dep), update the `basaltPip` probe and install command assertions
   to expect the system-python commands (TASK-001).
2. In `packages/providers/tests/adapters.spec.ts` (the `pollHealth` spec), add
   tests for the early-exit path:
   - A `pollHealth` call with a handle whose `hasExited()` returns `true`
     returns immediately (a failed result, no full timeout).
   - A `pollHealth` call with a handle whose `hasExited()` returns `false`
     keeps polling (the full loop).
   - A `pollHealth` call with a handle that has no `hasExited` (a stub) keeps
     the full poll.
3. In `packages/providers/tests/basalt.spec.ts` (the Basalt adapter spec), add
   a test that the `healthCheck` returns a failed result immediately when the
   tracked child has exited.
4. In `packages/providers/tests/adapters.spec.ts` (the `spawn` spec), add a test
   that the node host's `spawn` handle reports `hasExited() === true` after the
   child settles and `false` while it is live.

## Definition of Done

- The `basaltPip` dep assertions match the system-python commands.
- New tests cover the early-exit `pollHealth` path (exited, live, and stub
  handles) and the node host's `hasExited` behavior.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
