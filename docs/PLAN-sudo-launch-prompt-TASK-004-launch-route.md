# TASK-004 launch route sudo event

- [x] Done 2026-11-04: `launchEngine` takes the optional `onSudo` and owns the
  service sudo observer for the run (register before the Get steps, clear in a
  `finally`); the observer appends the `SUDO_CLI_NOTE` line to the run's
  Get-step log sink, calls `persistProcessLog(SUDO_CLI_NOTE)` while the run is
  hung, then the route's `onSudo`, and the route streams the exact
  `{"sudo":true}` line; `apply` builds the route host through
  `createNodeLifecycleHost(undefined, { notify: (command) =>
  localInfer.notifySudoNeeded(command) })` and passes it to both route slots.
  The card's `providers/lib/index.js` import source is unavailable (the index
  does not re-export `createNodeLifecycleHost`, carried to TASK-010), so the
  import is from the emitted `providers/lib/adapters.js`. `pnpm vitest run
  packages/ui` passes (207 tests; the full suite 1486) and `pnpm lint` is
  clean; the tracked `packages/ui/lib` outputs regenerate with the `src`
  change and `dsh/client.js` stayed untouched.

**Phase 2. Depends on TASK-002, TASK-003. Definition of Done: `pnpm vitest run
packages/ui` passes and `pnpm lint` is clean.**

`packages/ui/src/routes/launch.ts` streams one more NDJSON event next to the
step and progress events:

```ts
| { sudo: true }
```

The run owns the sudo observer, not the route, so the note lands in the
persisted run and in the stream from one place:

- `launchEngine` (`packages/ui/src/ops/engine.ts`) takes an optional
  `onSudo?: () => void`. For the duration of the run it registers
  `localInfer.setSudoObserver(...)` and unregisters it in a `finally`
  (`setSudoObserver(undefined)`), so a failing run leaves no observer and a
  second card never observes another run's sudo.
- The observer body does three things, in this order: appends the
  `SUDO_CLI_NOTE + '\n'` line to the run's `getLogs` sink (so
  `composeLaunchLogs` and `persistLaunchOutcome` carry it into the last-run
  logs and the log file), calls `persistProcessLog(SUDO_CLI_NOTE)` so the line
  is on disk while the run is still hung, and calls `onSudo` (the route's
  stream writer).
- The route's `onSudo` writes `ndjsonLine(res, { sudo: true })`.

`packages/ui/src/index.ts` `apply` now constructs the route host explicitly so
its sudo notify reaches the service:
`registerLocalInferRoute(scope, localInfer, host, host)` with
`host = createNodeLifecycleHost(undefined, { notify: (command) => localInfer.notifySudoNeeded(command) })`
(from `../../../providers/lib/index.js`). Tests that omit the arguments keep
the existing defaults.

Extend `packages/ui/tests/route.spec.ts`: driving a launch whose host calls
`notifySudoNeeded` yields a `{"sudo":true}` NDJSON line, the exact
`Check your CLI for a sudo prompt` line in the persisted last-run logs, and no
registered observer after the run settles.
