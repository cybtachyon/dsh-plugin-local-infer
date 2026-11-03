# TASK 017 — Record the Basalt build-dependency list as a tracked to-do

**Phase:** 4 — Codebase quality and maintainability
**Depends on:** TASK 010

## What

The Basalt build-dep list is declared in the TASK 010 OS profiles, but the exact
package names for the CUDA 13 toolkit and the C++20 compiler per distro are not
all verified on a live host. Mark the unverified install blocks (the CUDA 13
apt/dnf/pacman/brew/winget commands and the MSVC C++ workload) with the
plan's "flagged when untested" convention (a comment in `deps.ts` / the profile
files) so a later live-host run can confirm them.

## Definition of Done

- The unverified Basalt install blocks carry an explicit "untested" comment.
- `pnpm build` and `pnpm test` pass.
