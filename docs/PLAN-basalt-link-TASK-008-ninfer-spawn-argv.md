# TASK-008: ninfer deploy persists the spawn argv too

Found by TASK-006: `NInferAdapter.deploy` spawns the `resolveLaunchArgv`
result without writing it back onto the plan, so a Windows build-tree
launch with `platform.engineDirectory` set (the joined absolute path)
persists a record argv the live process never carries, and `reLinkRecord`
reads the engine `foreign` after a host restart. Same D4 defect class that
TASK-005 fixed for basalt. Linux and macOS bare names keep record argv
equal to spawn argv today, but the write-back makes the guarantee hold on
every OS.

Files: `packages/providers/src/engines/ninfer/ninferAdapter.ts` (around
line 313), `packages/providers/tests/ninfer.spec.ts` (or the spec that
covers ninfer deploy).

Changes:

- Before the spawn, write the resolved spawn argv back onto the plan
  (`plan.argv = resolvedArgv`), same one-line pattern and comment voice as
  eb4b99b.
- Test: a deploy through the host stub leaves `plan.argv` equal to the argv
  the host spawned.

Definition of done: the ninfer spec passes; `pnpm build` lands the tracked
providers lib outputs; commit.

Depends on: TASK-006 (found it).
