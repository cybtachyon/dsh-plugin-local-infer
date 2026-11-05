# TASK-012 publish the sudo notify seam

- [x] Done 2026-11-04: `notifySudoNeeded` is public on the class and declared on
  `LocalInferService`; `sudoAnnouncer` is gone and the lifecycle host calls the
  interface method; the ui service stubs carry the no-op sudo members, closing
  the carried issue. `pnpm vitest run packages/service packages/providers
  packages/ui` passes (710 tests) and `pnpm lint` is clean; the tracked
  `packages/service/lib` and `packages/providers/lib` outputs regenerate with
  only this change.

**Phase 2 prerequisite for TASK-004. Definition of Done: `pnpm vitest run
packages/service packages/providers packages/ui` passes and `pnpm lint` is
clean.**

Found while reviewing TASK-003 (commit c8a6129). `notifySudoNeeded` is private
on `LocalInferServiceClass` and absent from the published `LocalInferService`
interface in `packages/service/src/types.ts`, so no other package can report a
sudo prompt. The providers plugin worked around it with a structural read that
silently no-ops when the method is missing
(`sudoAnnouncer` in `packages/providers/src/index.ts`).

- Make the method public on the class and declare it on the
  `LocalInferService` interface next to `setEngineDeathObserver`, documented as
  the seam a command runner reports a waiting sudo prompt through.
- Drop the structural read in `sudoAnnouncer` and call the interface method
  directly; keep the no-observer behavior on the service side (that is where
  the "nobody is listening" case belongs).
- Add the no-op member to the service stubs in `packages/ui/tests/bootstrap.spec.ts`
  and `packages/ui/tests/route.spec.ts` so the stubs satisfy the widened
  interface (the carried issue in the plan index).

Test in `packages/service/tests/sudo.spec.ts`: a registered observer receives
the command from the published method; a throwing observer still cannot break
the caller.
