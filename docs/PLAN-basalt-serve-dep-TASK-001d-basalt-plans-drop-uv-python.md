# TASK-001d: Drop the stale uv `python` dep from the basalt plans

## Context

The basalt plans (`packages/providers/src/engines/basalt/basaltLinux.ts` line 34,
`basaltWindows.ts` line 37) still include `SYSTEM_DEPS.python`, which probes and
installs `uv`. After TASK-001, the basalt serve CLI resolves its python as
`<src_dir>/.venv/bin/python` if present, else the system `python3` (uv is not in
that path). So the uv `python` dep in the basalt plans is a leftover of the
pre-TASK-001 design, and its purpose string ("runs the uv Python server and its
pip requirements") is now misleading in the basalt context.

## Work

1. In `packages/providers/src/engines/basalt/basaltLinux.ts` and
   `basaltWindows.ts`, remove `SYSTEM_DEPS.python` from the `systemDeps` array
   (the `basaltPip` dep now covers the serve requirements, and the serve CLI
   uses the system python, not uv).
2. Keep `SYSTEM_DEPS.basaltPip` (the serve requirements) and the other basalt
   deps (cmake, compiler, cuda-toolkit, hf-cli) unchanged.
3. Update any test that asserts the basalt plans' `systemDeps` array (the
   `acquire.spec.ts` or `deps.spec.ts` basalt plan assertions) to expect the
   array without `SYSTEM_DEPS.python`.

## Definition of Done

- The basalt plans' `systemDeps` array no longer includes `SYSTEM_DEPS.python`
  (the uv dep); the `basaltPip` dep and the other basalt deps are unchanged.
- The test that asserts the basalt plans' `systemDeps` array is updated.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
