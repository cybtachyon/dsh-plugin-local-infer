# TASK-010 - Refactor review of the plan's commits

Review the files touched by the previous 8 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Watch specifically for: the unchecked-default (`?? false`) decision restated in
more than one place instead of one helper; the per-adapter `docker pull` guard
copy-pasted where a shared deploy helper fits; and doc comments still describing
`ui.autoRebuild` after the move. Commit resolutions with the emitted outputs.
