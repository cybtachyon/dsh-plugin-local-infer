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

- [ ] Each risk above: resolved with a commit, or recorded in this file with
      the reason it stays.
- [ ] `pnpm build`, `pnpm test`, `pnpm lint` green after the refactor.
