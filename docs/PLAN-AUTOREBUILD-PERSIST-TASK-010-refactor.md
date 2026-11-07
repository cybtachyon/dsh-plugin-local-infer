# TASK-010 - Refactor review of the plan's commits

Review the files touched by the previous 9 commits and identify the following code risks:
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

## Deferred candidates collected during execution (triage, fix what fits)

- card.spec.ts: four deps fixtures stub `/local-infer/deps` with a non-DepsModel
  shape (would crash DepsPanel on any post-ack render); normalize to a full
  DepsModel mock.
- Checkbox/Edit locators: old tests index `input[type=checkbox]` / count Edit
  buttons; consolidate on the label-text locator helper from d77a65f.
- Duplicated client test-harness helpers (makeStore, providerWith, summaryWith,
  routeFetch, jsonAnswer, launchStream, flush) copy-pasted across
  providers.spec.ts / actions.spec.ts and others; lift a shared helpers module.
- handlers.spec.ts save tests share the scratch HOME config without a per-test
  reset (order-sensitive).
- writeConfig's eight positional parameters are a data clump behind writeStored.
