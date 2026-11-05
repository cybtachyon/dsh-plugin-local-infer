# TASK-010 Refactor shared sudo paths

- [x] TASK-010 complete.

Status: complete. Resolution summary:

- Resolved: all four draft-abandon paths (Cancel, New, Discard, delete's
  form collapse) clear `ui.sudoPending` through one `abandonedFormPatch`.
- Resolved: one process-group kill rule per host. The service's sudo kill and
  abort now share a `signalChild` extracted from `watchChildAbort` (mirroring
  the providers host), and both hosts spawn the guarded/build shells detached
  and signal the group through the negative pid, with the direct kill kept as
  the fallback (and as the whole rule for the non-detached paths: the
  download runner's child, the exec-based `run`, Windows). No third copy of
  the SIGINT/SIGTERM rule was added.
- Resolved: the Get route closes its persisted run with
  `captureRunBaseline`/`finishRunSection`, so the mid-run sudo note and the
  collected run text persist the note once (the test now pins the count).
- Resolved: the `!! ` Get marker lives once as `GET_EVENT_PREFIX`.
- Resolved: `createNodeLifecycleHost` and `SudoHook` are re-exported from the
  providers barrel; the ui entry no longer reaches the `lib/adapters.js`
  subpath.
- Resolved: the `packages/ui` route-spec service stub is typed without
  `as unknown as LocalInferService` (no-op members fill the interface).
- Resolved: `packages/client/tests/bundle.spec.ts` fails when `dsh/client.js`
  predates `packages/client/src` (mtime plus git-history freshness).
- Resolved: the modsearch `--deadline 60000` literal is a named constant; the
  service prose copy of the CLI note now names `SUDO_CLI_NOTE`.
- Deliberate leaves (documented in code): the note string keeps its one
  mirrored copy per side (the client cannot import the node core); the
  two-per-package signal rule and probe remain by design (each package owns
  its child wiring); the stop deadline keeps its own single-settle pair
  outside `armDeadline`; `run`'s exec'd child stays direct-killed (exec
  forbids detached, and its deploy lines are single sudo commands the shell
  execs); the launch machine's `'sudo'` state literals stay as the union's
  discriminants.

Refactor: Review the files touched by the previous 9 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Focus for this change set:

- The note string `Check your CLI for a sudo prompt` exists once per side
  (core `SUDO_CLI_NOTE`, one client constant). Verify no third copy.
- The sudo observer register/persist/notify sequence is shared by
  `launchEngine` and `getEngine`, not pasted twice.
- The child-signal rule (`SIGINT` then `SIGTERM`) is not a third copy next to
  the two `watchChildAbort` functions the codebase already documents.
- `armDeadline` in `packages/client/src/store/providers.ts` carries one settle
  path for the health, stop, and sudo timeouts.
- No literal `60000`, `65000`, or bare `'sudo'` string outside its named
  constant.
