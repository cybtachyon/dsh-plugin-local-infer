# TASK-002 - Save route persists autoRebuild with each provider

Make a Save write the checkbox value onto the provider entry it upserts.

- File: `packages/ui/src/routes/save.ts`.
- Parse `body.autoRebuild` only when it is a boolean.
- Upsert rules (all three paths: id-update, match-update, new entry):
  - body carries the boolean -> write it;
  - body omits it -> carry the existing entry's `autoRebuild` over (an old save
    caller never drops a stored value);
  - body omits it and the entry is new -> leave the key absent (reads as
    unchecked on the card; no migration).
- A `settingsOnly` save leaves the providers list untouched (already true; pin
  it with a test).
- DoD: save-route tests (extend `packages/ui/tests/handlers.spec.ts` or the
  existing save spec) for the three paths plus settings-only. Commit with the
  emitted `lib/` output.
