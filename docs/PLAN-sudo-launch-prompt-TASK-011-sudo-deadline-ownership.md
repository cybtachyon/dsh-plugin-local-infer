# TASK-011 sudo deadline ownership

**Phase 3 insert, executes before TASK-008. Definition of Done: `pnpm vitest run
packages/client` passes and `pnpm lint` is clean.**

Found while reviewing TASK-007 (commit b93ec0e). `armDeadline(timeoutMs)` keeps
the first arm, so a sudo announcement that lands during the prereqs or build
phase owns the run's single deadline for good. If the user then types the
password and the run reaches the health poll, the stale 65 s sudo timer still
fires and settles a legitimately launching engine to the red Logs state,
short-circuiting the 150 s health cap.

In `packages/client/src/store/providers.ts` `performEntryLaunch`:

- Track which timeout owns the armed deadline (a `deadlineKind: 'health' | 'sudo' | null`
  alongside the existing `deadline` variable) instead of testing `deadline !== null`.
- A `step` event means the run resumed: when the armed deadline is the sudo
  one, clear it and leave the slot free, so the `launch` step arms the
  health-poll cap as it always has. A health-poll deadline is never cleared by
  a step event.
- Keep one `setTimeout` variable and one `move({ type: 'failed' })` settle path;
  the change is ownership, not a second timer.

Also in the same file, so one agent owns it: clear the `ui.sudoPending` flag on
the paths that abandon a draft run (the provider form's Cancel in
`cancelProvider`, and the discard/new-provider paths), not only on
`performDraftLaunch`'s settle, so a stale flag can never paint the form
control "Sudo needed" after the run is gone.

Tests in `packages/client/tests/providers.spec.ts`: sudo at 10 s, resume, then
the `launch` step arms the health cap and no failure lands at 65 s (advance
past 65 s, then past 150 s to confirm the health cap owns it); a sudo wait that
never resumes still fails at 65 s; a Cancel with `sudoPending` set clears the
flag.
