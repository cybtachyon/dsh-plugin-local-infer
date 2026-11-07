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

## Resolutions (2026-11-06)

Applied:
- The per-adapter acquisition guard `options?.autoRebuild !== false` (10 restatements across
  the NInfer, llama.cpp, Strata, Basalt, Infernix, and Hyper-Qwen deploys, the compose
  `--pull` mapping, and the Get steps' sync/build skip) now prices the flag through the
  core-exported `autoRebuildEnabled(autoRebuild?)` predicate (`packages/core/src/adapter.ts`),
  the single source for "an absent flag keeps the acquisition" (the CLI-legacy rule). The
  client-side reads stay `?? false` (an entry with no stored key draws unchecked) and were
  deliberately not unified with the server predicate.
- The save route's three Auto Rebuild carry blocks (body wins, else stored, else no key)
  consolidated onto the `carryAutoRebuild` helper in `saveRoute`.
- card.spec.ts: the four loose deps fixtures plus the full one now share the
  `depsAnswer()` helper (a full satisfied-empty `DepsModel`).
- card.spec.ts: the three `findAll(checkbox)[0]` field edits now locate the Flag field
  through the `fieldCheckbox` label-text helper (renderField's sibling-label row shape;
  `autoRebuildBox` keeps the label-nested `renderCheckbox` shape). The
  renders-the-full-form presence sweep stays a generic count.
- handlers.spec.ts: both describes wipe the scratch home's `.dsh` tree in a `beforeEach`,
  so each test reads the scaffold default or its own seeded config.

Considered, not applied:
- Client shared spec-helpers module: the copies are not compatible (makeStore: 9 identical
  of 12, 3 divergent; summaryWith: 4 variants across 8 files; routeFetch/launchStream/
  providerWith: 2 variants each; flush's signature varies). A faithful lift is a per-file
  behavior audit, not a mechanical extraction; kept as a follow-up.
- `writeConfig`'s positional parameters: about 120 call sites (mostly ui tests); an
  object-parameter change is high churn with no behavior win.
- A client-side `?? false` named helper: the five reads (card checkbox, editProvider,
  performEntryLaunch, draftLaunchBody, performSave) are the language idiom already; the
  rule is documented on `CardDraft.autoRebuild`. A wrapper would add indirection, not
  clarity.
- The save route's two upsert blocks stay separate: folding the id-path and the
  match-path would change the (pinned) id-not-found drop behavior.
