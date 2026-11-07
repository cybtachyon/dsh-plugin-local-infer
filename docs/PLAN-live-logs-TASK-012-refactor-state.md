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

Definition of Done:

- [ ] Each risk above: resolved with a commit, or recorded in this file with
      the reason it stays.
- [ ] `pnpm build`, `pnpm test`, `pnpm lint` green after the refactor.
