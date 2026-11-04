# TASK-003: Make the health poll stop early when the engine exits

## Context

The `pollHealth` function (`packages/providers/src/adapters.ts`) polls the
health URL until it reports 200 or the 120-attempt cap. If the engine process
exits (a crash), the poll never gets a 200, so it runs the full timeout. The
launch should end immediately when the engine crashes.

## Work

1. In `packages/providers/src/adapters.ts`, `pollHealth`, accept an optional
   `ProcessHandle` (the tracked child the deploy step spawned). On each poll
   attempt, before the fetch, check `handle.hasExited?.() === true`; when the
   child has settled, return immediately with `{ healthy: false, state:
   'failed', detail: 'the engine process exited before it reported ready' }`
   (or the exit code/signal the handle carries, when available). A handle with
   no `hasExited` (a stub) keeps the full poll.
2. Thread the handle through the adapters' `healthCheck` methods. The Basalt
   adapter (`packages/providers/src/engines/basalt/basaltAdapter.ts`) already
   tracks its child in `this.children`; pass the tracked handle to
   `pollHealth`. Apply the same change to the other process-plan adapters that
   use `pollHealth` (NInfer, llama.cpp, Infernix, Strata) so a crash ends the
   poll early for every local engine, not just Basalt.
3. The `state` a crashed engine reports is `failed` (the process is gone), not
   `starting`. A handle that has logs but has not exited keeps `starting`.

## Definition of Done

- `pollHealth` stops early when the tracked child has exited (via
  `hasExited`), returning a failed result with a detail naming the exit.
- The Basalt adapter (and the other process-plan adapters) thread the tracked
  handle into `pollHealth`, so a crash ends the poll early for every local
  engine.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
