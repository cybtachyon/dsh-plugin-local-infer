# TASK-003 - Summary read model carries autoRebuild per provider

The card's provider entries and edit form read the stored value through the
summary.

- Files: `packages/ui/src/viewmodels/summary.ts`.
- Add `autoRebuild?: boolean` to `ProviderSummaryEntry` (include the key only
  when the stored entry carries it; exactOptionalPropertyTypes).
- Carry it in the `linkedProviders.map(...)` provider mapping in `buildSummary`.
- DoD: viewmodel/summary test asserting a stored `autoRebuild: false` shows on
  the entry and an entry without the key carries no key. Commit with the
  emitted `lib/` output.
