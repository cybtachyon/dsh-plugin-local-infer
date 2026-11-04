# TASK-001b: Align the basalt build block with the system-python target

## Context

The basalt Linux build block (`packages/providers/src/engines/basalt/basaltLinux.ts`,
line 21) chains `uv pip install -r {dir}/requirements.txt` after the cmake
build. That installs the serve requirements into the `uv` environment, not the
system python the basalt serve CLI falls back to (`python_interpreter` in
`src/platform/system.cpp`). So the build-time install does not reach the
interpreter the serve CLI reads, and the serve requirements are only available
if the `basaltPip` dep (TASK-001, now system python) has already installed them.

## Work

In `packages/providers/src/engines/basalt/basaltLinux.ts`, the build block:

1. Change the `uv pip install -r {dir}/requirements.txt` step to
   `python3 -m pip install -r {dir}/requirements.txt` (with `sudo` where the
   system python needs it, matching the `basaltPip` dep's per-manager convention),
   so the serve requirements land in the system python the serve CLI reads.
2. Keep the cmake build steps unchanged.
3. Update any test that asserts the build block's `uv pip install` command
   (`packages/providers/tests/basalt.spec.ts`, line ~215) to expect the
   system-python command.

## Definition of Done

- The basalt Linux build block installs the serve requirements into the system
  python (matching the `basaltPip` dep), so the serve CLI's `python_interpreter`
  fallback finds them.
- The test that asserts the build block's pip command is updated.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
