# TASK-011: `ProviderRow` status dot + readout while getting

## Context

`ProviderRow` in `packages/client/src/render/ProviderList.tsx` renders each
saved provider entry: a status dot (`renderStateDot` with
`STATUS_TO_DOT[provider.status]`), an "Engine: Model (status)" title, and
Edit/Cancel, Delete, and per-entry Launch controls. While a Get run is in
flight for the edited provider, the request wants the row's status dot to
swap to the `StateDot` ongoing spinner and the readout to be appended to the
row title.

The `'getting'` branch (TASK-010) and `formatProgressReadout` (TASK-010) are
the shared sources. The in-flight Get is detected the same way the branch
does (the get action cell / in-flight registry).

## Change

- `packages/client/src/render/ProviderList.tsx` (`ProviderRow`):
  - When a Get run is in flight for this row's provider, render the status
    dot as the ongoing spinner (`renderStateDot('ongoing')` / the
    `renderThrobber()` primitive) instead of the status-mapped dot.
  - Append the live progress readout (from `formatProgressReadout` over
    `state.ui.getProgress`) to the row title, e.g.
    `Engine: Model (getting) · 42% · 43.2/102.4 GB · ETA 12:31`.
  - Keep the existing title and controls otherwise unchanged.

## Definition of Done

- A test/render assertion: with a Get run in flight and a populated
  `getProgress`, the row shows the ongoing spinner and the readout in the
  title; with no Get in flight the row is unchanged (existing tests pass).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/render/ProviderList.tsx`
- the client render tests (under `packages/client/tests/`).
