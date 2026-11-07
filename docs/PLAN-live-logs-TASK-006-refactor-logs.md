# TASK-006 (Refactor): Review logs-phase commits for code risks

Dependencies: TASK-001 through TASK-005.

Review the files touched by the previous 5 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Focus areas from this phase:

- Sudo observer single global slot (`localInfer.setSudoObserver` in
  `packages/service/src/index.ts`, used by `registerSudoObserver` in
  `packages/ui/src/ops/engine.ts`): concurrent provider runs clobber each
  other's observer and the first settle clears the other's note routing.
  Make notification per-run-key (the hub already keys by provider) or
  reference-counted, with tests for two concurrent runs.
- Download / chat-template routes lack the `abortOnResponseClose` cancel
  wiring the get and launch routes have, so a card Cancel on a standalone
  download never interrupts the hf child. Add parity with tests.
- `packages/ui/src/routes/stop.ts` sits at ~33% line coverage (tests call
  `stopEngine` directly): add route-level stop POST tests.
- Route-list triplication (shotgun edit): adding a route needs coordinated
  edits in `registerLocalInferRoute`, the exact-paths array in
  `packages/ui/tests/route.spec.ts`, and the paths array + count title in
  `packages/ui/tests/bootstrap.spec.ts`. Introduce one shared expected-list
  the tests derive from.
- Log-stream lifecycle on bundle toggle-off: open `/local-infer/logs`
  connections keep their hub subscription until the socket closes (no
  route-side registry tears them down when the effect disposes). Same shape
  as the existing get/launch streams; decide to fix (track open
  subscriptions per registration and dispose them) or record the reason it
  stays.
- `ACTION_TIMEOUTS.get` equals `GET_IDLE_MS` (120 s each,
  `packages/client/src/store/`): with a Get streaming progress past 120 s
  the performAction deadline settles the cell error('timeout') while the
  run continues in the background. Reconcile the two (deadline just past
  the idle cap, or a progress-aware deadline) with a test.
- `launchEngine` in `packages/ui/src/ops/engine.ts` still keeps its
  server-side run text in a closure named `getLogs` (old client-buffer
  name); rename to a run-text name to kill the confusion magnet.
- Accepted impurity (record the reason it stays): `cardReducer` reads the
  `run-markers.ts` registry to decide whether summary/ack keeps `liveLogs`
  (documented, in the spirit of the `abort.ts` registry and the
  `Date.now` precedent); a purist fix threads the flag through the action
  payload.
- The run-key rule (provider id / engine+model match / engine fallback) must
  live in exactly one exported helper that every route and op calls.
- `persistProcessLog`, `finishRunSection`, `persistStoredLogs`,
  `persistLaunchLogs` (`packages/ui/src/ops/logs.ts`, `ops/engine.ts`) and
  the new `appendRunLog` appends: fold the shared join/cap/tail rule into
  one place; no run should hand-assemble the same separator lines twice.
- The poll interval, tail cap, and reset semantics: named constants with
  doc comments, no inline literals.
- The poller in `logs-poll.ts` and the stop-poll loop in
  `providers.ts performEntryStop` are both "setTimeout chain keyed by
  provider"; note (and resolve or record) whether they share a helper.

Definition of Done:

- [x] Each risk above: resolved with a commit, or recorded in this file with
      the reason it stays.
- [x] `pnpm build`, `pnpm test`, `pnpm lint` green after the refactor.

## Risk ledger

Per-category reading of the five phase-1-2 commits, and where each focus
item landed.

- Multiple Sources of Truth. Resolved: the run-key rule is the one exported
  `runLogKey` (service) every route and op calls, with the documented
  `clientRunLogKey` hand-mirror; the tail cap rule is the exported
  `capRunLogs` (ops/logs.ts) shared by `joinRunLogs`,
  `persistStoredLogs`, `persistLaunchLogs`, and `handleEngineDeath`; the
  log-file write rule is the exported `writeRunFile` (engine.ts
  `persistLaunchLogs` no longer re-implements it); the Canceled line is the
  one `CANCELED_LINE` constant in ops/logs.ts that the Get, launch,
  download, chat-template, and stop-cancel paths all write.
- Duplicate Code. Resolved: the download/chat-template routes now share the
  `abortOnResponseClose` cancel rule with get and launch instead of running
  uncancelable; the sudo-note registration rule lives in the one
  `registerSudoObserver` helper launchEngine and getEngine share; the
  file-write/mkdir/catch block that appeared in both ops/logs.ts and
  persistLaunchLogs is one function; the route table lives in
  `packages/ui/tests/route-paths.ts` (route.spec paths assertion, the 405
  wrong-method complement, and the bootstrap.spec registration list and
  count all derive from it).
- Bloaters. Noted, left: `launchEngine` is long because its doc comment
  carries the run's whole contract; splitting it further would scatter the
  bracket/finally pairing that keeps the hub run and sudo hook balanced per
  settle path. No new branch was added to it beyond the rename and the key
  threading.
- Data Clumps. Left as-is: the `(engineId, config, providerId)` group that
  travels through the persist helpers is already one clump, the
  `LaunchRequest`, that `resolveStoredRequest` resolves once; adding a
  second carrier type would be a second source of truth.
- Shotgun Edits. Resolved for the route list (shared table above). The
  wire-format mirror (host `LogsStreamEvent` and client `RunLogsEvent`) is
  recorded: it is a deliberate two-endpoint mirror (host and browser cannot
  share a runtime module in the lazy-CJS card), kept honest by the client
  logs-stream contract tests.
- Feature Envy. Noted, left: the run persisters read the stored config the
  ops layer owns; that is the layer boundary working, not envy.
- Magic Numbers. Resolved: `LOG_TAIL_BYTES`, `RECONNECT_BACKOFF_MS`,
  `GET_IDLE_MS`, `GET_PROGRESS_THROTTLE_MS`, `NO_FIXED_DEADLINE`,
  `ACTION_TIMEOUTS`, `SUDO_DEADLINE_MS`, and the stop/launch health
  deadlines are all named exports with doc comments; no new inline
  timeout or cap literal landed.

Focus-item dispositions beyond the categories:

- Sudo observer: fixed. The service keeps a `Map` of hooks keyed by run key
  (`registerSudoObserver(key, observer)` returns a disposer that clears
  only its own hook). Notification fans out to every live hook: the
  announce seam (`createNodeLifecycleHost`'s fixed `SudoHook.notify` and
  the service's own `runInstall` guard) does not name the triggering run,
  so per-key delivery is impossible; the accepted tradeoff is that
  concurrent runs each land the `SUDO_CLI_NOTE` in their own run text and
  persist it once while hung. Tests: two concurrent runs both hear, one
  settle keeps the other's slot; a re-launch takes its key's slot and the
  stale disposer keeps the live hook.
- Download/chat-template cancel parity: fixed with tests (hanging download
  stub, response close, hub run ends on the Canceled line, running false).
- Stop route tests: fixed; stop.ts is at 100% lines (200 + record clear +
  pid threading, 500 + failure note in the hub run).
- Logs-stream lifecycle on toggle-off: fixed. `logsRoute` tracks a closer
  per open connection; `registerLocalInferRoute`'s effect disposer calls
  `closeOpenStreams()` before unregistering, so a bundle switch off ends
  the responses and drops the hub subscriptions. (The get/launch streams
  end when their route's `run` returns, so they own no lingering
  subscription; the logs route's is open-ended by design and needed the
  registry.)
- Get deadline vs idle cap: reconciled by dropping the fixed get deadline.
  `NO_FIXED_DEADLINE = 0` in sync.ts arms no performAction timer; the
  progress-aware `GET_IDLE_MS` cap re-armed per progress event is the get
  cell's only deadline. Tests: the table pins get to the sentinel, no
  timer arms for it, and a stream that keeps producing progress holds the
  cell pending past every fixed cap and settles ok('idle') one full cap
  after the last progress line.
- `getLogs` rename: done (`runText` / `appendRunText` and the persist
  helpers' `runText` parameter); no `getLogs` identifier remains in
  ops/engine.ts.
- Accepted impurity (verified true, stays): `reducer.ts` imports
  `isLiveRunAttached` from run-markers.ts in `summary/ack` handling, the
  same registry-plus-`Date.now` shape the abort.ts registry already uses
  (documented at the reducer's summaryAck comment); threading the flag
  through the action payload would push a derived fact into every
  dispatcher call site.
- logs-poll.ts vs the stop-poll chain: recorded, no shared helper. The
  client logs poller was removed with the TASK-005 streaming switch (the
  file no longer exists); `performEntryStop`'s stop-poll loop is the only
  setTimeout chain keyed by provider left, so there is no second caller to
  fold.
- Persist fold: done as described under Multiple Sources of Truth; the
  seed separator lines (`GET_RUN_SEED`, `LAUNCH_RUN_SEED`,
  `DOWNLOAD_RUN_SEED`, `INSTALL_RUN_SEED`, `STOP_RUN_SEED`) stay one
  constant each shared by the hub seed and the persisted section, so no
  run hand-assembles a separator twice.
