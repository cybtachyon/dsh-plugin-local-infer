# TASK-03 - performEntryLaunch takes an optional draft launch context

File: `packages/client/src/store/providers.ts`.

- `performEntryLaunch(store, provider, t, draftOverride?: CardDraft)`: when an
  override is present (the open provider form's draft), the request sends the
  DRAFT's engine, config, platform entry, and Auto Rebuild checkbox
  (an absent draft `autoRebuild` reads as false) through the existing
  top-level launch body keys, plus the entry's `providerId` (the launch
  record persists on that entry; the launch record is lifecycle state, not
  settings). Without an override the body is byte-identical to today's.
- The run-log key (`clientRunLogKey`) is computed from the DRAFT engine/config
  when an override is present, mirroring the host rule.
- The settle path re-prices (`repriceAll`) with the DRAFT engine/config.
- The launch machine, phase labels, health/sudo deadlines, and abort tracking
  stay keyed on `provider.id`.
- `performEntryStop`, `performDraftLaunch`, and `performDraftStop` are not
  changed.

Definition of Done:
- client vitest specs: with an override, the posted body carries the draft
  engine/config/platform-entry/autoRebuild and `providerId` the entry id;
  without one the body is today's; the run key mirrors the draft values; no
  `/local-infer/save` call. `pnpm build` and `pnpm test` green.
