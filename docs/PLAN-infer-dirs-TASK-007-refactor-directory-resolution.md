# TASK-007: Refactor the directory-resolution code touched so far

Refactor:

Review the files touched by the previous 6 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Focus areas for this change set: the model-directory precedence repeated in
`summary.ts`, `hf.ts`, `model.ts`, and `get-steps.ts` (collapse to one
shared resolver); leftover `${HOME}/.cache` literals; the
`modelDir`/`useHubCache` pair traveling together through the ops (candidate
for the `ModelDownloadTarget` value already in core); stale doc comments
describing the old `join(modelDir, engineId)` and config-in-model-dir rules.

Definition of Done: each risk listed above is either resolved or explicitly
dismissed with a one-line note in the commit message; suites, build, and
lint stay green; committed.

Depends on: TASK-002..TASK-006.
