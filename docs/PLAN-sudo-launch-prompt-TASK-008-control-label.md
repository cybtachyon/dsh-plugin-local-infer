# TASK-008 Sudo needed control label

**Phase 3. Depends on TASK-007. Definition of Done: `pnpm vitest run
packages/client` passes and `pnpm lint` is clean.**

Both Launch controls read the same derivation, so one label mapping covers
them:

- `packages/client/src/text.ts`: add `entrySudo: 'Sudo needed'` to the English
  table (beside `entryPrereqs` / `entryBuilding`) and the Chinese table
  (`'需要 sudo'`), following the existing key order.
- `packages/client/src/store/derive.ts` `phaseLabelFor`: map `'sudo'` to
  `t.entrySudo`, so the settings-form control (`Card.tsx`
  `renderTitleBarControl`, the `phase` branch) and the provider entry's
  `EntryLaunchButton` (`packages/client/src/render/ProviderList.tsx`) change
  from Launch to "Sudo needed" at the same moment.
- Dark orange text in this state. Add one constant to
  `packages/client/src/styles.ts` (name it after the state, e.g.
  `SUDO_STATE_LABEL_COLOR`) holding
  `var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-warning, #ff9f0a))`
  and paint it on the control's text in both renderers, following the existing
  red `--dsw-alias-label-error` Logs-button pattern. Keep the phase branch's
  busy throbber and no-click behavior.
- The fresh-draft form control has no machine entry, so `deriveLifecycleControl`
  also reads a new `ui.sudoPending` flag (set by `performDraftLaunch`'s sudo
  callback, cleared on settle and on reset) and renders the same "Sudo needed"
  label and color while it is set.

Update `packages/client/tests/derive.spec.ts`,
`packages/client/tests/providerlist.spec.ts`, and
`packages/client/tests/card.spec.ts` to assert both controls read "Sudo needed"
from the `sudo` machine status and carry the warning token color.
