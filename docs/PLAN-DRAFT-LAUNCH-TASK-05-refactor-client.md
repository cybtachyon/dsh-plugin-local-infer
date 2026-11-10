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
- Pre-existing issue to FIX here (recorded in the plan's Discovered
  pre-existing issues): `Card.tsx` `onValue` and `onPlatform` rebuild the
  `draft/edit` payload literal without the `autoRebuild` key, and the
  `draft/edit` reducer replaces the draft wholesale, so toggling Auto Rebuild
  and then editing any field silently unchecks the box (a draft-submitted
  launch then sends `autoRebuild: false` against the user's intent). Spread
  the current draft in both dispatches. `onEngine`'s config reset on engine
  switch may be an intentional autoRebuild reset; leave it unless clearly
  wrong. Add a spec pinning: toggle Auto Rebuild, then edit a field, and the
  checkbox (and the draft-submitted launch body) keeps it true. Remove the
  ordering workaround in the TASK-04 card.spec test if it exists.
- Multiple sources of truth between `draftLaunchBody` and the
  `performEntryLaunch` body construction (both name draft launch values now).
- Data clump: engine + config + platform + autoRebuild traveling together
  through the drivers.

Definition of Done:
- Each risk is either resolved or recorded as not present, with the file and
  reasoning named in the commit message body.
- `pnpm build` and `pnpm test` green after the pass.
