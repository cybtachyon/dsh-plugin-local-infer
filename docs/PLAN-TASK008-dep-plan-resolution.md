# TASK 008 — Refactor the dep-plan resolution to read per-platform deps

**Phase:** 2 — Refactor: per-platform build dependencies
**Depends on:** TASK 006, TASK 007

## What

Update `packages/providers/src/deps.ts` and the service `deps` entry point in
`packages/service/src/index.ts`:

- Source the `local` build-mode list from the host OS's `EngineOsProfile.deps`
  (via `engineOsProfile(engineId, os)` in `acquire.ts`), so a Windows host reads
  the Windows profile's deps and every other host reads the Linux profile's.
- Keep the `docker` and `binary` build-mode lists central (they are not
  platform-specific in the same way); drop the now-redundant `windows` nested
  variant from `EngineDepPlan` in `packages/core/src/deps.ts` once the OS
  profiles carry the Windows lists.

## Definition of Done

- `pnpm build` type-checks; the service `deps` entry point resolves the
  per-platform local list for a given host OS.
- A unit test asserts a Windows host reads the Windows profile's local deps and a
  Linux host reads the Linux profile's, for at least one engine.
- All existing provider and service tests pass; the `windows` nested variant is
  removed from `EngineDepPlan` with no test regressions.
