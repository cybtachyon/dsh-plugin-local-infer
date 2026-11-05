# TASK-009 build artifacts and repo gates

**Phase 4. Depends on TASK-001 .. TASK-008. Definition of Done: every gate below
exits 0 and the emitted artifacts are committed with the source change.**
 - [x] Done: all five gates exit 0; `dsh/client.js` was stale at HEAD and the
       rebuilt bundle (with the sudo client half) is committed with the README
       paragraph.

1. `pnpm build` (runs `tsc -b`, then `node scripts/build-client.mjs`, then
   `node scripts/build-format.mjs`). Commit the tracked `packages/*/lib`
   outputs and `dsh/client.js` alongside the source. If a `git clean` left a
   stale `packages/*/tsconfig.tsbuildinfo`, delete it and rebuild.
2. `pnpm test` then `pnpm test:coverage`; the coverage thresholds in
   `vitest.config.ts` (lines 90 / functions 93 / branches 78 / statements 90)
   must clear. Add cases, not suppressions.
3. `pnpm lint`.
4. `prek run --files <changed paths>`.
5. Docs: add a short paragraph to `README.md` under the launch/troubleshooting
   material describing the behavior a user sees: a launch that needs sudo
   prints `Check your CLI for a sudo prompt` in the Logs section and the log
   file, the Launch buttons read "Sudo needed", and the run fails after 60
   seconds without a password.
6. Report the host-restart requirement in the final summary: host-side packages
   need a bundle reinstall or a plugin toggle plus a host restart; a page
   refresh only picks up `dsh/client.js`.
