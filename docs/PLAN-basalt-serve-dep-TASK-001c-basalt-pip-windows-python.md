# TASK-001c: Fix the Windows python interpreter name in the basaltPip dep

## Context

The `basaltPip` dep (`packages/providers/src/systemDeps.ts`, `basaltPip`)
TASK-001 changed to target the system python. The `winget` (Windows) install
block (line 290) uses `python3 -m pip install ...`, but on Windows the
interpreter is `python`, not `python3`. So the Windows install line may not
resolve. (Basalt is Blackwell-only and cannot run on Windows, so this block is
unlikely to be used, but it should be correct.)

## Work

In `packages/providers/src/systemDeps.ts`, `basaltPip`:

1. Change the `winget` install block to use `python -m pip install ...` (not
   `python3`), so the Windows install line resolves on a Windows host.
2. Keep the probe (`python3 -c 'import ...'`) and the Linux/macOS install
   blocks (`python3 -m pip install ...`) unchanged (they are correct for the
   platforms basalt runs on).
3. Update the `deps.spec.ts` test that asserts the `basaltPip` install commands
   (TASK-004) to expect `python -m pip install ...` on `winget`.

## Definition of Done

- The `basaltPip` dep's `winget` install block uses `python` (not `python3`),
  so the Windows install line resolves.
- The test that asserts the `basaltPip` install commands is updated.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
