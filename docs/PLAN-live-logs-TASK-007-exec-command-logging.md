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

- [x] An audit table appended to this file: site -> change made or
      no-change-with-reason.
- [x] Tests: model download, chat-template download, dep install, git sync,
      and build each assert the `$ <command>` line precedes the command's
      output lines in the run log.
- [x] `pnpm build` and `pnpm test` green.

## Exec audit table

Every `child_process` / `spawn(` / `exec(` / `execFile(` hit in
`packages/*/src`, plus every LifecycleHost exec call site the grep surfaces.
Change = the `$ <command>` line now reaches the run's log sink before the
child spawns; Keep = no change, with the reason.

| Site | Verdict |
| --- | --- |
| `service/src/index.ts` `downloadModel` (downloadRunner spawn) | Change: renders the hf command and writes `$ <command>\n` to `options.onLog` before the runner spawns. |
| `service/src/index.ts` `downloadChatTemplate` (same runner) | Change: same seam; `$ <command>\n` through `options.onLog` before the spawn. |
| `service/src/index.ts` `runInstall` (guardedShellRunner spawn) | Change: wraps the runner so each install command's `$ <command>\n` reaches `options.onLog` before the guarded child spawns; core `runInstall` stays sink-free. |
| `service/src/index.ts` `runCommand` execFile probe | Keep: read-only presence/capability probes (`which`/`where`, `nvidia-smi`, `ps -eo`, `powershell`, `docker --version`, `sudo -n`); the task keeps probes unlogged and no run sink threads them. |
| `service/src/index.ts` `fetchPreset` modsearch spawn | Keep: read-only URL fetch through the modsearch CLI, not an engine-run exec; preset-fetch logging is TASK-008 scope. |
| `ui/src/ops/get-steps.ts` `runModelDownloadStep` emit | Change: removed the caller-side `$ hf download` emit; the service's exec site writes it through `downloadOptions`' `onLog`, so the line appears exactly once per run in every path. |
| `ui/src/ops/get-steps.ts` `runChatTemplateStep` emit | Change: same removal, same seam. |
| `ui/src/ops/get-steps.ts` Infernix extras | Keep: already emits `$ <command>` command-first; the `host.run` fallback carries no stdout (CommandOutcome is `{ok, detail}`) and its failure detail already trails the `$ ` line. |
| `ui/src/ops/get-steps.ts` `runDepsStep` (gate-on path) | Change: passes `{ onLog: emit }` to `localInfer.runInstall`, so install command lines reach the Get run's sink ahead of the `  <id>: <status>` results. |
| `ui/src/ops/hf.ts` `downloadFor` (download route) | Change: `onLog` appends the service's `$ ` line to the live hub and folds it into the persisted run section (single copy). |
| `ui/src/ops/hf.ts` `chatTemplateDownloadFor` | Change: `onLog` appends the `$ ` line to the live hub (the template route's persisted run keeps its existing shape). |
| `ui/src/ops/engine.ts` `launchEngine` | Change: threads `onLog: appendRunText` into `localInfer.launch`, so deploy-side `$ ` lines land in the launch run (hub + persisted runText). The `[local-infer] launch:` command note stays as the lifecycle marker; the `$ ` lines are the exec audit. |
| `ui/src/ops/engine.ts` `stopEngine` | Change: threads a hub-appending log into `localInfer.stop`, so compose down / docker stop / pid-signal command lines land ahead of each child. |
| `ui/src/ops/engine.ts` `handleEngineDeath` | Change: persisted note now rides `writeStored(providers)` + the shared `persistProcessLog` fold (also writes the per-run file) instead of a bespoke `lastLogs` tail-join; hub snapshot/append/conditional-`endRun` contract unchanged. |
| `ui/src/ops/engine.ts` `registerSudoObserver` | Change: exported so the install route registers the same SUDO_CLI_NOTE fan-out (hub + persist) under its run key. |
| `ui/src/viewmodels/depsHelpers.ts` `runInstallFor` | Change: registers the sudo hook under the install run key, and passes `onLog` appending each install command's `$ ` line to the live hub before its child spawns. The install route persists no run text today (only the sudo note persists); its `$ ` lines are live-hub only. |
| `providers/src/adapters.ts` host `run`/`runStream` (`exec`/`execFile`/spawn) | Keep: the generic host seam; every mutating caller now logs its own `$ ` line (acquire `runLogged`, adapter `auditRun`/`stopProcessPlan`, guarded runner through the service). The `sudo -n` probe execFile is read-only. |
| `providers/src/adapters.ts` host `spawn` (engine process) | Keep: the engine spawn is audited by `launchEngine`'s `[local-infer] launch: <formatLaunchCommand(plan)>` note, written before deploy for all three plan kinds (process argv, docker argv, compose up). |
| `providers/src/adapters.ts` `stopProcessPlan` | Change: takes the stop run's log and writes `$ kill <pid>` / `$ taskkill /PID <pid> /T` before `host.run`; adds the shared `auditRun(host, command, log?, options?)` helper all adapter execs now run through. |
| `providers/src/engines/hyperqwen` deploy compose up | Change: `auditRun` through `options.onLog`. The `[local-infer] launch:` note also names the up line; the note is the lifecycle marker, the `$ ` line is the exec audit (dedup rule applies to hf command lines, which now have exactly one writer). |
| `providers/src/engines/hyperqwen` stop compose down | Change: `auditRun` through the stop log. |
| `providers/src/engines/ninfer` deploy (docker pull, hf model download, hf chat-template download) | Change: `auditRun` through `options.onLog` / the threaded `log`. |
| `providers/src/engines/ninfer`, `llamacpp`, `strata` stop (docker stop, `strata launch --stop`) | Change: `auditRun` through the stop log. |
| `providers/src/engines/llamacpp`, `strata` deploy docker pull; strata binary install | Change: `auditRun` through `options.onLog`. |
| `providers/src/engines/llamacpp`, `basalt`, `infernix` deploy-time hf model download | Change: `auditRun` through `options.onLog` (normally skipped by the presence guard; logged when it runs). |
| `providers/src/engines/strata` `discoverModel` curl | Keep: read-only `/v1/models` probe. |
| `providers/src/acquire.ts` `syncEngineRepo` | Keep: every mutating git command (clone, remote add/set-url, fetch, rebase) already echoes command-first through `runLogged`; the `rev-parse --is-inside-work-tree` presence probe is read-only and unlogged. |
| `providers/src/acquire.ts` `syncAndRebuildEngine` | Change: `git remote add`, `git remote set-url`, and the best-effort `git fetch ... || true` flipped from `echo:false` to command-first (they mutate the checkout and previously surfaced only in failure details). `git status --short` and `git rev-list --count` keep `echo:false`: read-only pricing probes. |
| `providers/src/acquire.ts` `buildEngineRepo` | Keep: every build step already runs command-first through `runLogged` (the symlink step and the manual-run echo included); the `command -v <binary>` probe is read-only. |
| `providers/src/systemDeps.ts` execFile probes | Keep: read-only presence probes with a timeout; excluded by the task. |
| `core/src/adapter.ts` LifecycleHost decls; `core/src/progress.ts`, `client/src/store/progress.ts` `.exec(` | Keep: type declarations and RegExp `.exec` string parsing, not `child_process`. The tool and client packages use no `child_process`. |

Test coverage of the rule (new or extended assertions):

- `$ <command>` precedes output: service journal tests for `downloadModel`,
  `downloadChatTemplate`, and `runInstall` (audit line before the runner
  call); `acquire.spec` clone/build lead tests; the install hub run asserts
  `$ sudo apt install cmake` sits between the seed and `  cmake: satisfied`;
  the download hub asserts command < chunks < settle; the launch hub asserts
  seed < `$ git clone` < `$ hf download` < launch note < build < engine.
- Exactly once per run: split-count assertions on the Get route run, the
  launch-embedded Get, the download route hub, the download route's persisted
  run, and the chat-template hub run.
- Adapter execs: `adapters.spec` tests for compose up/down, docker pull,
  docker stop, and `kill` each capture the sink line and the host's run
  count at emit time, proving the line lands before the child.
