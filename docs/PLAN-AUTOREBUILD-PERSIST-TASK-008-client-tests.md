# TASK-008 - Client test suites updated for the per-provider checkbox

- Files: `packages/client/tests/useCardStore.spec.ts` (the `ui/patch`
  `autoRebuild` dispatch), `packages/client/tests/card.spec.ts` (checkbox row),
  `packages/client/tests/client.spec.ts` (source pins: `autoRebuild:
  state.ui.autoRebuild` becomes the draft-based expression).
- Add the regression tests:
  - a provider saved unchecked still reads unchecked after a fresh store fed
    the fresh summary (the original bug: reset on save/reload);
  - a stored entry without the key renders unchecked and its entry launch body
    carries `autoRebuild: false`;
  - a checked provider's entry launch body carries `autoRebuild: true`.
- DoD: `npx vitest run packages/client` green (full gates in TASK-009).
