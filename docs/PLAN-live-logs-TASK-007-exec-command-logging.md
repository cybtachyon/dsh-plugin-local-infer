# TASK-007: Every exec writes its command line before it runs

Dependencies: TASK-006.

Audit every host-side exec statement and make each mutating command write
`$ <command>` to the run log (and therefore the persisted run and log file)
first, then append the CLI results as they land. Audit sites found during
planning (extend as the audit discovers more):

- `packages/service/src/index.ts`:
  - the hf download runner spawn (~line 1965, `downloadModel` /
    `downloadChatTemplate` path): log `$ <hf command>` before the spawn;
    remove the caller-side `emit('$ hfDownloadCommand(...)')` in
    `packages/ui/src/ops/get-steps.ts` (`runModelDownloadStep`,
    `runChatTemplateStep`) so the command logs exactly once, from the exec
    site (single source of truth).
  - `guardedShellRunner` (~line 1799, `runInstall` path): log each install
    command line before the spawn (the core `runInstall` in
    `packages/core/src/deps.ts` today reports only per-dep status after the
    run); thread the run's log sink through `localInfer.runInstall` the way
    `downloadModel` threads `onChunk`.
  - `runCommand` probe users: read-only probes (`which`/`where`,
    `nvidia-smi`, `ps -eo`, `docker --version`, `sudo -n` probe) stay
    unlogged; record this exclusion with its reason in this file.
- `packages/providers/src/acquire.ts` `syncEngineRepo` /
  `buildEngineRepo`: verify every git / build command they run is emitted
  through their existing `emit` sink before it runs (command first, output
  after); fix any that only appear in a failure detail.
- `packages/providers/src/adapters.ts` (~line 504 `exec`, ~line 598
  `spawn`): the deploy-time engine spawn already has the
  `launchCommandNote`; the compose up/down and any other exec'd command
  lines log `$ <command>` before running through the run's log sink.
- `packages/providers/src/systemDeps.ts` (`execFile` probes): read-only,
  same exclusion as above; record it.
- The Infernix extras in `get-steps.ts` already emit `$ command`; verify the
  `host.run` fallback path (no `runStream`) still appends the outcome text.

Carried in from TASK-006's ledger (install-path logging parity, same files):

- `packages/ui/src/viewmodels/depsHelpers.ts` `runInstallFor` brackets a
  hub run but registers no sudo hook, while the service's `runInstall`
  announces guarded installs through the fan-out (`registerSudoObserver(key,
  observer)` from TASK-006): a sudo-hung dependency install shows no CLI
  note on the card. Register the run's hook under the install run key,
  writing the same `SUDO_CLI_NOTE` line the launch/get paths write.
- `handleEngineDeath` (`packages/ui/src/ops/engine.ts`) still writes its
  note to the stored `lastLogs` via `writeStored` directly: verify it
  reaches the hub's live side through `appendRunLog` (per the TASK-002
  snapshot/append/conditional-end contract already wired in route.ts) and
  that the persisted side goes through the shared `persistProcessLog` /
  `capRunLogs` fold instead of a bespoke `writeStored` tail-join.

Definition of Done:

- [ ] An audit table appended to this file: site -> change made or
      no-change-with-reason.
- [ ] Tests: model download, chat-template download, dep install, git sync,
      and build each assert the `$ <command>` line precedes the command's
      output lines in the run log.
- [ ] `pnpm build` and `pnpm test` green.
