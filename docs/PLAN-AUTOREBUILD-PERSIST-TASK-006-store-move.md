# TASK-006 - Card store: move Auto Rebuild from ui state into the draft

The checkbox value must ride the provider being edited: through `cachedDraft`,
discard, save, and both launch drivers.

- Files: `packages/client/src/store/types.ts`, `reducer.ts`, `providers.ts`,
  `actions.ts`.
- `CardDraft`: add `autoRebuild?: boolean` (the per-provider checkbox edit;
  absent reads as unchecked). Remove `autoRebuild` from `CardUiState` and
  `initialCardState`; fix the doc comments ("never syncs" lists).
- `reducer.ts` `summaryAck`: preserve the live `draft.autoRebuild` through the
  platform merge; a null-draft seed leaves it absent (unchecked).
- `providers.ts`:
  - `editProvider`: load `provider.autoRebuild ?? false` (missing stored key
    reads as unchecked per Q1).
  - `newProvider`: a restored `cachedDraft` keeps its value; a fresh draft
    leaves it absent (unchecked).
  - `draftLaunchBody`: `autoRebuild: draft?.autoRebuild ?? false` when a draft
    exists.
  - `performEntryLaunch`: send `autoRebuild: provider.autoRebuild ?? false` in
    the launch body (today it sends none, so saved entries always rebuild).
- `actions.ts` `performSave`: include `autoRebuild: draft.autoRebuild ?? false`
  in the save body (every card save records the checkbox with the provider).
- DoD: store tests: editProvider defaults an absent key to unchecked and loads a
  stored true; draft/edit through the checkbox value survives a summaryAck and a
  cachedDraft round trip; launch bodies carry the expected boolean; save body
  carries it. Commit with the emitted `lib/` output.
