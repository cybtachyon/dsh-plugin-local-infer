# TASK-010: `'getting'` branch in `deriveLifecycleControl`

## Context

`deriveLifecycleControl` in `packages/client/src/store/derive.ts` computes
the title-bar control spec. `LifecycleControlKind` is
`'phase' | 'stop' | 'logs' | 'launchStop'`. Today a Get run in flight reads
as a greyed-out disabled Launch (via `deriveLaunchDisabled`, which gates on
`actions.get.status === 'pending'`). The request wants a distinct `'getting'`
branch: a busy throbber with a live readout
(`Downloading… 42% · 43.2/102.4 GB · ETA 12:31`) instead.

`CardState.ui.getProgress` (TASK-007/008) carries the live
`GetProgressState`. The readout text is built from it (percent,
done/total bytes in GB, ETA in mm:ss).

## Change

- `packages/client/src/store/derive.ts`:
  - Add `'getting'` to `LifecycleControlKind`.
  - In `deriveLifecycleControl`, before the default Launch/Stop branch, add a
    branch: when a Get run is in flight (`actions.get.status === 'pending'`
    or the in-flight registry reads true) render a `'getting'` control:
    `busy: true`, a `busyLabel` built from `ui.getProgress` (the live
    readout, falling back to a plain "Getting…" label when no progress state
    has landed yet), `variant: 'ghost'`, `disabled: false`, and a field the
    render layer uses to draw the progress strip (e.g. a `progress` field on
    the control spec carrying the `GetProgressState | null`).
  - Add a pure `formatProgressReadout(state: GetProgressState, t: TextTable): string`
    helper the branch and the provider row (TASK-011) share, so the readout
    text has one source.
- `packages/client/src/text.ts`: add the readout label keys (en + zh) the
  branch needs (e.g. a `gettingReadout` template or the individual pieces),
  keeping the zh table typed against en.

## Definition of Done

- A test asserts: with `actions.get.status === 'pending'` and a populated
  `ui.getProgress`, `deriveLifecycleControl` returns `kind: 'getting'` with a
  busy throbber and the live readout label; with no progress state yet it
  returns the `'getting'` kind with the plain fallback label.
- The existing `'phase'`, `'stop'`, `'logs'`, and `'launchStop'` branches
  are unchanged (existing tests pass).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/store/derive.ts`
- `packages/client/src/text.ts`
- the client derive tests (under `packages/client/tests/`).
