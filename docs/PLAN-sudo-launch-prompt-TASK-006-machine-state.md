# TASK-006 launch machine sudo state

**Phase 3. Depends on TASK-004. Definition of Done: `pnpm vitest run
packages/client` passes and `pnpm lint` is clean.**

In `packages/client/src/machine/launch.ts`:

- Add `'sudo'` to `LaunchStatus` and a `{ type: 'sudoNeeded' }` event.
- Transitions: `sudoNeeded` moves any in-flight state (`prereqs`, `download`,
  `build`, `launch`, `downloading`, `sudo`) to `sudo` and clears the cause.
  From `sudo` a `step` event moves to the named step (the run resumed after the
  user typed the password), `healthy` settles to `running`, `failed` settles to
  `failed`, `stop` moves to `stopping`, `reset` settles to `idle`. An idle or
  running control ignores `sudoNeeded` (a no-op, like every other illegal
  event).
- Extend the module doc comment: `sudo` is the "the host is waiting for a
  password on the terminal" state, and it is the same state whether the wait
  ends with the run resuming or with the 60 s timeout settling to `failed`.

Cover every transition in `packages/client/tests/launch.spec.ts`, including the
cause-preserving `reset` cases.
