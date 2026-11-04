# TASK-003 lifecycle host sudo guard

**Phase 1. Depends on TASK-001, TASK-002. Definition of Done: `pnpm vitest run
packages/providers` passes with a stubbed child and an injected timer, and
`pnpm lint` is clean.**

In `packages/providers/src/adapters.ts`, `createNodeLifecycleHost` takes an
optional second parameter `sudo?: { notify: (command: string) => void; timeoutMs?: number }`
and every `run` / `runStream` call drives core's `guardSudoCommand` (imported
from `../../core/lib/index.js`) when the call's `RunOptions` declares
`needsSudo: true`. No command text is inspected.

- `kill` signals the in-flight child the same way `watchChildAbort` does (SIGINT,
  then SIGTERM after the grace period). Reuse the existing escalation: extract a
  small `signalChild(child)` helper both `watchChildAbort` and the sudo kill
  call, so the signal rule has one home.
- When the guard reports `timedOut()`, the settled `CommandOutcome` is
  `{ ok: false, detail: sudoFailureDetail(command) }` regardless of the exit the
  killed child reports.
- `disarm()` runs on `close`/`error` in both `run` and `runStream`.
- With no `sudo` hook the host behaves exactly as before (no probe, no notify,
  no deadline).

In `packages/providers/src/index.ts` `apply`, build the shared adapter host with
`createNodeLifecycleHost(createDshDebugLogger(ctx), { notify: (command) => localInfer.notifySudoNeeded(command) })`
so a deploy step's `sudo ln -sf ...` reports through the service seam.

In `packages/providers/src/acquire.ts` the `/usr/local/bin` symlink line passes
`{ needsSudo: true }` to `runLogged` (thread the options argument through
`runLogged`, which already takes an options argument for the profile shell).

Test in `packages/providers/tests/adapters.spec.ts`: a run declared
`needsSudo: true` with a stub probe that reports "password needed" emits one notify, and when the
injected timer fires the child is signalled and the outcome is the sudo failure
detail; a non-sudo command never probes; a passing probe never notifies.
