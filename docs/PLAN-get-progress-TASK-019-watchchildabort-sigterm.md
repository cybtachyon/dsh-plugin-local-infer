# TASK-019: fix the `watchChildAbort` SIGTERM escalation guard

## Context

Discovered during TASK-002: `watchChildAbort` in
`packages/service/src/index.ts` (just above `downloadRunner`) has a latent
bug in its cancel-escalation path. On abort it sends SIGINT
(`child.kill('SIGINT')`), which sets `child.killed = true`. The SIGTERM
escalation guard then reads `if (!child.killed && child.exitCode === null)
child.kill('SIGTERM')` — but `child.killed` is already `true` from the
SIGINT, so the guard is always false and SIGTERM never fires. A child that
ignores SIGINT (a stuck hf CLI) runs to the 2-hour `DOWNLOAD_TIMEOUT_MS`
instead of being SIGTERM'd after the 5 s `DOWNLOAD_ABORT_GRACE_MS`. This
breaks the cancel path the progress-streaming work builds on.

## Change

- `packages/service/src/index.ts` (`watchChildAbort`): change the
  escalation guard from `!child.killed && child.exitCode === null` to a
  still-alive check `child.exitCode === null && child.signalCode === null`,
  so a child that is still running (neither exited nor signalled) gets
  SIGTERM after the grace period. Update the doc comment if it references the
  old guard.

## Definition of Done

- A test asserts: a spawned child that ignores SIGINT (e.g. a shell that
  traps SIGINT) is SIGTERM'd after the grace period when the signal aborts
  (the promise settles with a signal-killed outcome, not the 2-hour
  timeout).
- The existing abort tests (an already-aborted signal kills immediately; a
  normal child settles on SIGINT) still pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test).

## Files

- `packages/service/src/index.ts`
- `packages/service/tests/local-infer.spec.ts`
