# TASK-04 - Title-bar Launch passes the draft while editing

Files: `packages/client/src/Card.tsx` (the `onControlClick` branch), specs in
`packages/client/tests/`.

- When `control.target === 'entry'`, `control.action === 'launch'`, and the
  form is editing that provider (`state.ui.editingProviderId === provider.id`
  with a non-null `state.draft`), pass the draft as the override to
  `performEntryLaunch`. Always while editing (the draft may be unedited; then
  it equals the stored values).
- The launch performs no store mutation of the draft and no server save:
  Save and Discard remain the only persistence paths.
- The collapsed-list row button (`EntryLaunchButton` in
  `packages/client/src/render/ProviderList.tsx`) keeps launching with the
  stored entry values (no draft is open for it).
- The running-provider Stop path stays unchanged (Stop keys on the persisted
  launch record's pid).

Definition of Done:
- card.spec / providers.spec coverage: editing a provider, changing a field,
  clicking the title-bar Launch posts the changed (draft) value to
  `/local-infer/launch`; no `/local-infer/save` fires from the click; the
  summary still shows the old stored value. `pnpm build` and `pnpm test`
  green.
