# TASK-012 (Refactor): Review audit/state-phase commits for code risks

Dependencies: TASK-007 through TASK-011.

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

- Command-line (`$ `) and URL (`> GET `) log prefixes: one constant/format
  shared by every exec site, not a literal per call.
- `launchEngine` (`ops/engine.ts`, 100+ line function) and `runGetSteps`:
  after the step-reporter addition, check for bloaters and pull cohesive
  groups (the sudo observer, the run-log begin/append/end bracket) into
  named helpers.
- The health-poll loops in `adapters.ts` and `strataAdapter.ts`: the URL-log
  addition should not be copy-pasted twice; extract or share.
- Step-name strings (`'prereqs'`, `'download'`, `'build'`, `'launch'`): the
  machine order map, the core `LaunchStep` union, and the displayText
  mapping must derive from one source per side (host union, client machine
  table).
- `packages/ui/tests/route.spec.ts` is a single ~5.5k-line spec: split by
  describe into per-route spec files (shared fixtures into a helper
  module), and pin the hidden shared-config state (a `writeConfig` in one
  describe leaking `allowRunDeps` into another; one test was pinned
  locally in TASK-009, sweep the rest).
- `packages/ui/tests/client.spec.ts` bundle-shape pins (source-shape
  strings over the built `dsh/client.js`) are a recurring tax on client
  refactors (TASK-010 had to re-pin two): derive the pins from the same
  exports under test or replace them with behavior assertions on the
  artifact where practical.
- `packages/ui/src/routes/launch.ts` sits at ~60% branch coverage (the
  broken-launch fallback lines 96-98): add route-level tests for the
  pre-plan failure path.
- From TASK-011: the machine 'downloading' state has no client settle
  path (the "re-polls" comment in the port matches no timer in either
  implementation), so a `downloading` entry stays "Downloading..." until
  a page reload. Fold the summary provider status (engine up -> running,
  down -> stays/settles per the machine's stop rules) into the machine or
  a settle timer for the `downloading` state, with tests.
- From TASK-011: `deriveLifecycleControl` has no summary-status fallback
  for a running engine with no machine entry (fresh card): the provider
  row reads Stop but the title-bar control reads plain Launch whose click
  no-ops. Price `provider.status === 'running'` into the launchStop
  branch, with a test for the no-machine running case.

Resolutions (commit, or recorded reason it stays):

- `$ ` / `> GET ` prefixes: resolved. `LAUNCH_STEPS`, `COMMAND_LOG_PREFIX`,
  `commandLogLine`, `URL_LOG_PREFIX`, `urlLogLine` joined core's
  `CommandLogger`; every host exec site (service install/download/
  chat-template, adapters audit + health poll, acquire echo, infernix
  extras), the test stub mirrors, and `strataAdapter` read the formatters
  (commit 8568401). The `!! ` settle-failure marker stays a per-site literal:
  each line names its own subject and no two sites share a sentence.
- Step-name strings: resolved. One host-side tuple (`core` `LAUNCH_STEPS`,
  the `LaunchStep` union derived from it) and one client-side tuple
  (`LAUNCH_PHASE_STATES`), pinned equal by a machine test; the machine order
  map keys derive from the client tuple.
- `launchEngine` bloater: partially resolved. The run-log begin/append/end
  bracket became `openRunLog` (commit bda5a2d); the sudo observer stays
  extracted as is. Recorded: the remaining ~100 lines are one linear
  narrative (plan render, Get steps, deploy, settle) over per-phase
  closures; slicing it further would scatter the run-log ordering contract
  the tests pin across more seams than it saves.
- `runGetSteps` and the positional parameter lists (`launchEngine`'s
  host/signal/onChunk/onSudo, `runGetSteps`' ctx fields): recorded. Each
  call site passes a distinct mix and every parameter is read at a
  different phase; grouping them into a context object would move the
  parameters into a type whose field order is the only information left.
  Left as is.
- Health-poll loops (`adapters.ts` `pollHealth` vs `strataAdapter`
  healthCheck): the URL-log line was already shared through
  `logHealthPoll`/`urlLogLine` (no copy-paste). Recorded: the surrounding
  loops differ in verdict vocabulary (ready/still downloading vs healthy/
  unhealthy), poll sources, and failure text; merging them into one loop
  would trade two readable loops for a parameterized one whose knobs all
  differ. Left as is.
- `routes/launch.ts` coverage: resolved. Two route-level tests settle the
  pre-plan failures (unknown engine RouteError; failed hardware probe,
  Error and non-Error detail) to a result event; the route file is at
  100% statements and branches (commit 50c75b2).
- `route.spec.ts` split: resolved (commit 5426dce). Seventeen describes
  into `summary/launch/model/handlers/get/logs/deps.spec.ts` with the
  shared fixtures in `packages/ui/tests/fixtures.ts` (the one real
  `RunLogStore`-backed stub service, the fake adapters, `pointHomeAt`,
  `stubGetHost`); 174 tests moved byte-identical in names, per-describe
  scratch HOMEs kept, vitest include already covered the new files.
- Shared-config hygiene: resolved for the leak class (commit 1e9801e).
  The launch/stop helper describe and the launch-body handler tests that
  never wrote config now pin the stored state (gate off, clean platform
  map, no providers). Recorded: the 413 payload tests fail body parsing
  before `readConfig`, the summary download cases pass every config field
  in the request, and the `provider list round trip` describe is an
  intentional provider-state chain; none read hidden state.
- `client.spec.ts` bundle pins: partially resolved (commit 3973890). The
  route-contract pin now derives the route literals from
  `packages/client/src/api/routes.ts`. Recorded: the identifier pins
  (`deriveLifecycleControl`, `launchNextState`, `performAction`, ...) are
  the tree-shake and wiring contract of the artifact, and the
  expression-shape pins carry the store-driven wiring through the bundle
  transform; the behavior behind each is unit-pinned in
  `packages/client/tests/`, so a contract rename deliberately costs one
  conscious re-pin. TASK-010's two re-pins were that review, not drift.
- Machine `downloading` settle: resolved (commit 2720268). The machine
  takes a `summaryStatus` event; the store folds it on every summary/ack
  (running -> running, stopped or vanished -> idle, unsure holds; a
  no-op for every other machine state). Limitation recorded in the code
  comments: the settle lands with the next summary read (the card has no
  periodic summary poll, only stop fast-poll and action-triggered
  reprice), and an `unsure` engine (model never tied, e.g. a strata
  config without `model`) holds the throbber. Q4's server-authoritative
  step semantics are unchanged.
- Title-bar Stop fallback: resolved (commit 2720268).
  `deriveLifecycleControl` prices `provider.status === 'running'` into
  the launchStop branch for both the idle-entry and no-entry edited
  provider, matching the provider row's rule; tests cover the fresh-card
  running case and the running-status-over-idle-machine read.
- Shotgun edits / feature envy / magic numbers over the five audited
  commits: no instance beyond the ones above. The run-log wire format
  (snapshot/log/runBegin/runEnd seq), the hub contract, and the client
  `RunLogsEvent` mirror were left untouched by design.

Definition of Done:

- [x] Each risk above: resolved with a commit, or recorded in this file with
      the reason it stays.
- [x] `pnpm build`, `pnpm test`, `pnpm lint` green after the refactor.
