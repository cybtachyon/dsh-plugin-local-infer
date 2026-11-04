# TASK-001e: Remove the orphaned `SYSTEM_DEPS.python` catalog entry

## Context

TASK-001d removed `SYSTEM_DEPS.python` from the basalt plans (the only engine
profiles that referenced it). The `SYSTEM_DEPS.python` catalog entry
(`packages/providers/src/systemDeps.ts`, id `python`, probes/installs `uv`) is
now orphaned: no engine profile references it anywhere in `src`. Its purpose
string ("runs the uv Python server and its pip requirements") is now misleading
since nothing uses it.

## Work

1. In `packages/providers/src/systemDeps.ts`, remove the `python` catalog entry
   (the `uv`-based dep). Keep the `basaltPip` dep and all other catalog entries
   unchanged.
2. Update any test that asserts the `python` catalog entry (the `deps.spec.ts`
   coverage, if it asserts the entry's id, probe, or install commands) to drop
   the now-removed entry.
3. Regenerate the lib artifacts (`packages/providers/lib/systemDeps.js` + maps)
   via `pnpm build`.

## Definition of Done

- The `python` catalog entry is removed from `systemDeps.ts`; the `basaltPip`
  dep and all other catalog entries are unchanged.
- Any test that asserted the `python` entry is updated.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
