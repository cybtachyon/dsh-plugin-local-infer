# TASK-002 service sudo seam and guarded install runner

**Phase 1. Definition of Done: `pnpm vitest run packages/service` passes, coverage
of the new module is exercised by fake timers, and `pnpm lint` is clean.**

In `packages/service/src/index.ts`:

1. Add the sudo observer seam to `LocalInferService`, mirroring the existing
   `setEngineDeathObserver` shape:
   `setSudoObserver(observer: ((command: string) => void) | undefined): void`
   plus a private `notifySudoNeeded(command: string): void` that calls the
   observer when one is registered and never throws.
2. Add `sudoProbe(): Promise<boolean>` (module-level): it runs
   `SUDO_PROBE_COMMAND` through `execFile` with the existing `PROBE_TIMEOUT_MS`
   and resolves true only on a clean exit. Add
   `sudoGuardFor(command, notify, kill, timeoutMs?)` as the thin service-side
   binding of core's `guardSudoCommand` (it supplies `probe: sudoProbe`), so
   both this package's runner and TASK-003's host call one function and the
   rule stays in core. Export the binding from the service package index so
   providers can reuse it; if a service-to-providers import edge is awkward at
   build time, providers calls core's `guardSudoCommand` directly with
   `probe: sudoProbe` re-exported instead. Either way the decision, the
   timeout, and the note have one home in core.
3. Wrap the install runner: `runInstall(deps, hw, shellRunCommand)` becomes a
   guarded runner built per call that reads the `needsSudo` option core now
   passes, so a `sudo apt install ...` line whose probe needs a password
   notifies the observer, is announced, and is killed with a
   `sudoFailureDetail` `CommandOutcome` at 60 s. Keep `shellRunCommand`'s
   existing stdin-closed spawn; the guard adds only probe, notify, deadline.
   The probe itself runs `SUDO_PROBE_COMMAND` through `execFile` with a short
   timeout (reuse `PROBE_TIMEOUT_MS`) and reads exit 0 as cached.

Tests in `packages/service/tests/local-infer.spec.ts` (or a new
`sudo.spec.ts`): a stub runner + fake timers asserting (a) a command the
runner did not declare sudo for never probes, (b) a declared-sudo command with
a passing probe never notifies and is never killed, (c) a declared-sudo
command with a failing probe notifies once, and the child is killed with a
failed outcome after 60 s, (d) a child that settles early disarms the timer.
