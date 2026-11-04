# TASK-004 launch route sudo event

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
