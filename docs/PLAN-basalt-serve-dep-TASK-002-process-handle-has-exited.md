# TASK-002: Add a `hasExited` method to `ProcessHandle`

## Context

The health poll (`pollHealth` in `packages/providers/src/adapters.ts`) runs the
full 120-attempt timeout even when the spawned engine process has already
exited (a crash). To stop the poll early, the `ProcessHandle` needs a way to
report "exited" (a state check, not the one-shot `onExit` listener).

## Work

1. In `packages/core/src/adapter.ts`, add an optional `hasExited?(): boolean`
   method to the `ProcessHandle` interface. The method reports whether the
   tracked child has settled (exited, been signalled, or failed to spawn).
   Absent on a handle that cannot report its exit state (a stub), so a caller
   that cannot check falls back to the full poll.
2. In `packages/providers/src/adapters.ts`, `createNodeLifecycleHost`'s
   `spawn`, implement `hasExited` on the returned handle: it reads the
   `exitInfo` state the `settle` function writes (the same state the `onExit`
   listener reads), so a handle whose child already ended reports `true` and a
   live child reports `false`. The empty-argv handle (the `pid: -1` early
   return) reports `true` (it settled with a spawn error).
3. Keep the `onExit` one-shot contract unchanged; `hasExited` is a separate
   state read.

## Definition of Done

- `ProcessHandle` carries an optional `hasExited?(): boolean` method.
- The node host's `spawn` implements it (reading the `exitInfo` state), and the
  empty-argv handle reports `true`.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
