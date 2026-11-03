# TASK 007 — Migrate every existing engine's OS profiles to declare `deps`

**Phase:** 2 — Refactor: per-platform build dependencies
**Depends on:** TASK 006

## What

Update the OS profile files in
`packages/providers/src/engines/{ninfer,hyperqwen,llamacpp,infernix,strata}`
(the `{Linux,MacOS,Windows}` files, plus the distro files that reuse the shared
Linux profile):

- Declare the platform's local build deps in each profile's `deps` field, moving
  the data out of `ENGINE_DEP_PLANS` in `packages/providers/src/deps.ts`. The
  Windows profile carries the winget/MSVC toolchain; the shared Linux profile
  carries the apt/dnf/pacman/brew toolchain.

## Definition of Done

- Every engine's OS profile declares its local build deps in `deps`.
- `pnpm build` type-checks and all existing provider tests pass.
- The `SYSTEM_DEPS` catalog in `deps.ts` is unchanged (it is the shared dep
  definitions); only the per-engine lists move.
