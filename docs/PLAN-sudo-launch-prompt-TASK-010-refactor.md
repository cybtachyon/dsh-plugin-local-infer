# TASK-010 Refactor shared sudo paths

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
