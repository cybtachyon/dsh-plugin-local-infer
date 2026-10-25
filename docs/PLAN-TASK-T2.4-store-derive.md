# T2.4 `src/store/derive.ts`.

Pure derivations:

- `deriveLifecycleControl(state)`: returns the single title-bar
  control spec (kind: `phase` | `stop` | `logs` | `launchStop`, label,
  variant, busy, disabled, onClick target: entry vs draft). Replaces
  the 4-way conditional at current lines 4404-4461.
- `deriveDisplayedLogs(state)`: streamed get buffer, else the
  summary's persisted logs, else ''.
- `deriveProviderFormMode(state)`: forced `'new'` when the summary has
  zero providers, else the stored mode.
- `deriveLaunchDisabled(state)`: disabled while a get is in flight
  or the deps panel reports unsatisfied.

**DoD:** unit tests cover every branch of the current conditional:
phase label while a rebuild phase is active; `running` -> Stop;
`failed` -> red Logs; a fresh provider (no entry) -> draft
Launch/Stop; editing a provider routes clicks to the entry actions;
disabled gating; `pnpm build` green.
