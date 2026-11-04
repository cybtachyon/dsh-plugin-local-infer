# TASK-001 core sudo primitives

**Phase 1. Definition of Done: `pnpm vitest run packages/core` passes and `pnpm lint` is clean.**

Create `packages/core/src/sudo.ts` and re-export it from `packages/core/src/index.ts`.
It holds the pure, host-independent parts of the sudo-prompt rule so the service
runner and the providers lifecycle host share one source of truth.

Declare:

- `SUDO_CLI_NOTE = 'Check your CLI for a sudo prompt'` — the exact line the Logs
  section, the log file, and the streamed run show when sudo is waiting.
- `SUDO_PASSWORD_TIMEOUT_MS = 60_000` — how long a sudo command may wait for the
  user to type the password on the CLI before the run kills it and fails.
- `SUDO_PROBE_COMMAND: readonly string[] = ['sudo', '-n', 'true']` — the
  non-interactive probe that answers whether sudo already holds cached
  credentials (exit 0) or is about to prompt on the terminal (non-zero).
- No sudo detection by string parsing. The caller declares the need:
  `CommandRunner` in `packages/core/src/deps.ts` grows a second parameter
  `options?: { needsSudo?: boolean }`, and `RunOptions` in
  `packages/core/src/adapter.ts` grows `needsSudo?: boolean`. The two existing
  sudo sources already carry the fact in data: `SystemDep.requiresSudo`
  (already declared per dependency, shown as the `(sudo)` hint in the deps
  panel) drives the install path, and the one hand-written sudo line
  (`sudo ln -sf ...` in `packages/providers/src/acquire.ts`) declares it at its
  own call site. Update every existing `CommandRunner` and host stub in the
  tests to the wider signature.
- `sudoFailureDetail(command: string): string` — the `CommandOutcome.detail`
  text for a command the sudo deadline killed, naming the note
  (`SUDO_CLI_NOTE`) and the timeout seconds.
- `guardSudoCommand(options): Promise<SudoGuard>` — the one shared guard the
  service install runner and the providers lifecycle host both drive, so the
  rule lives once. It is pure: it takes injected callbacks, no child process.
  Contract: a command that does not `commandNeedsSudo` resolves to
  `{ announced: false, disarm() {} }` with no probe; a command whose `probe()`
  resolves true (cached credentials) resolves the same, with no notify and no
  timer; a command whose `probe()` resolves false calls `notify(command)` once
  and arms a `SUDO_PASSWORD_TIMEOUT_MS` timer (overridable through
  `options.timeoutMs`) whose fire calls `kill()`. The returned `disarm()`
  clears the timer, and a guard whose timer already fired reports
  `timedOut(): boolean` true so the caller can build `sudoFailureDetail`.
  Options: `{ needsSudo, command, probe, notify, kill, timeoutMs?, timer? }`
  where `needsSudo` comes from the caller (never inferred from the command
  text) and `timer` is an injectable `{ set, clear }` pair defaulting to
  `setTimeout` and `clearTimeout` so a test drives the clock.
- `packages/core/src/deps.ts` `runInstall` passes the declaration through:
  `runCommand(command, { needsSudo: dep.requiresSudo })`.

Add `packages/core/tests/sudo.spec.ts` covering: the constants' values; a guard
whose `needsSudo` is absent or false never probes, notifies, or arms; a passing
probe notifies nothing; a failing probe notifies once and kills at the
timeout; an early `disarm()` prevents the kill; the timeout reports
`timedOut()`. Extend `packages/core/tests/deps.spec.ts` to assert a
`requiresSudo: true` dep's commands arrive at the runner with
`{ needsSudo: true }` and a `brew`-style `requiresSudo: false` dep's do not.

Follow the repo doc-comment style (`// [Name] [verb]s [what].`). No `node:`
imports in this module; core stays free of child-process wiring.
