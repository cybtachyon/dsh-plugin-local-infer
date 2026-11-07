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

Definition of Done:

- [ ] Each risk above: resolved with a commit, or recorded in this file with
      the reason it stays.
- [ ] `pnpm build`, `pnpm test`, `pnpm lint` green after the refactor.
