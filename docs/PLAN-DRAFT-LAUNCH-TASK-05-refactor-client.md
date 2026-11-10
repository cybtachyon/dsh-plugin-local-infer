# TASK-05 - Refactor (client phase)

Review the files touched by the previous 4 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
 - **Overengineering**: Methods with single lines of code or slim classes.
Then address and resolve each risk.

Watch specifically for:
- Multiple sources of truth between `draftLaunchBody` and the
  `performEntryLaunch` body construction (both name draft launch values now).
- Data clump: engine + config + platform + autoRebuild traveling together
  through the drivers.

Definition of Done:
- Each risk is either resolved or recorded as not present, with the file and
  reasoning named in the commit message body.
- `pnpm build` and `pnpm test` green after the pass.
