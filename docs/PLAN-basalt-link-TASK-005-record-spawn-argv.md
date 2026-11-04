# TASK-005: launch record carries the spawn argv

Makes the persisted launch record survive `reLinkRecord`'s command-line
check after a host restart.

Files: `packages/providers/src/engines/basalt/basaltAdapter.ts`,
`packages/providers/tests/basalt.spec.ts`.

Verified on the live host (2026-11-04): the stored record's argv carries
the `--model` placeholder path (the hub-cache baseDir join), but the
process serves the content-addressed blob path, so `commandMatchesArgv`
fails on that one token and `reLinkRecord` reads the engine `foreign`. The
resolved spawn argv (the concrete blob `--model` value plus the
`resolveLaunchArgv`-resolved binary) matches the live command line on every
token.

Changes:

- In `deploy`, after `resolveLaunchArgv`, write the actual spawn argv back
  onto the plan (`plan.argv = resolvedArgv`) before spawning, so
  `launchRecordFromPlan` persists the argv the process actually carries.
  Comment why: the re-link rule substring-matches every record argv token
  against the live command line, so the record must name the spawn, not the
  pre-swap placeholder.
- Update the `withModelArgv` doc comment (it no longer keeps the plan's
  placeholder in the record).
- Test: a deploy through the host stub leaves `plan.argv` equal to the argv
  the host spawned, including the concrete `--model` artifact path.

Definition of done: `pnpm vitest run packages/providers/tests/basalt.spec.ts`
passes; `pnpm build` lands the tracked lib outputs; commit.

Depends on: TASK-003, TASK-004 (same file, run after).
