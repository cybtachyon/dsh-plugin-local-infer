# TASK-005: Refactor the Basalt fix

Refactor:

Review the files touched by the previous 3 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

## Context

The previous 3 commits are the Basalt fix (TASK-002 config path, TASK-003
`--model`/`--engine-bin` flags, TASK-004 model path resolution), all in
`packages/providers/src/engines/basalt/basaltAdapter.ts`. Review that file for
the risks above and resolve each one.

## Definition of Done

- Each identified risk in `basaltAdapter.ts` is resolved (or explicitly noted as
  acceptable with a reason).
- The task is checked `[x]` in `PLAN-basalt-launch.md`.
