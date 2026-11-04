# TASK-020: fix the providers `watchChildAbort` SIGTERM escalation guard

## Context

Discovered during TASK-019: `watchChildAbort` in
`packages/providers/src/adapters.ts` (the providers package's own copy, used
by the Get/Launch `run` / `runStream` cancel paths) has the identical latent
bug TASK-019 fixed in the service package. On abort it sends SIGINT
(`child.kill('SIGINT')`), which sets `child.killed = true`. The SIGTERM
escalation guard then reads `if (!child.killed && child.exitCode === null)
child.kill('SIGTERM')` — always false, so a SIGINT-ignoring child (a stuck
hf CLI on the Infernix extra-download path) runs to the run cap instead of
being SIGTERM'd after the `RUN_ABORT_GRACE_MS` grace.

## Change

- `packages/providers/src/adapters.ts` (`watchChildAbort`): change the
  escalation guard from `!child.killed && child.exitCode === null` to a
  still-alive check `child.exitCode === null && child.signalCode === null`,
  mirroring the TASK-019 fix. Add an optional `graceMs` parameter (defaulting
  to `RUN_ABORT_GRACE_MS`) if the test needs to exercise the escalation
  without waiting, the same way TASK-019 did. Update the doc comment.

## Definition of Done

- A test asserts: a SIGINT-ignoring child run through the provider host's
  `run`/`runStream` is SIGTERM'd after the grace period when the signal
  aborts (the outcome settles failed with a signal-killed detail, not the
  run cap).
- The existing provider abort tests still pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test).

## Files

- `packages/providers/src/adapters.ts`
- the provider tests that exercise the run/runStream abort path (under
  `packages/providers/tests/`).
