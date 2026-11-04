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
- Unit-aware readout (flagged during TASK-010): the file-count bar shape
  (`Fetching N files`) stores file counts in `doneBytes`/`totalBytes`, so
  the byte-oriented readout renders `0.0/0.1 GB` for it. Add a
  `unit: 'bytes' | 'files'` field to the progress state so the readout can
  render the file-count shape as `43/102 files`:
  - `packages/core/src/progress.ts`: add `unit: 'bytes' | 'files'` to
    `HfProgress`; the parser sets `'files'` for the file-count shape and
    `'bytes'` for the byte shape.
  - `packages/client/src/api/routes.ts`: add `unit` to `HfProgressShape`
    (the client mirror of the core shape).
  - `packages/client/src/store/progress.ts`: `GetProgressState` is an alias
    of `HfProgressShape`, so it picks up the field; the client parser sets
    `unit` the same way the core parser does.
  - `packages/client/src/store/derive.ts` (`formatProgressReadout`): when
    `unit === 'files'`, render the sizes as a file count
    (`43/102 files`) instead of GB; keep the GB rendering for
    `unit === 'bytes'`.
  - The `{ progress }` NDJSON event shape gains the `unit` field
    (additive; the client reader picks it up through `HfProgressShape`).

## Definition of Done

- A test/render assertion: with a Get run in flight and a populated
  `getProgress`, the row shows the ongoing spinner and the readout in the
  title; with no Get in flight the row is unchanged (existing tests pass).
- `formatProgressReadout` renders a file-count state
  (`unit: 'files'`, `doneBytes: 43`, `totalBytes: 102`) as a file count
  (`43/102 files`), and a byte state (`unit: 'bytes'`) as GB.
- The core and client parsers set `unit` correctly for both shapes (the
  existing parser tests are extended to assert the field).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/render/ProviderList.tsx`
- `packages/core/src/progress.ts`
- `packages/client/src/api/routes.ts`
- `packages/client/src/store/progress.ts`
- `packages/client/src/store/derive.ts`
- the client render + parser tests and the core parser tests (under
  `packages/client/tests/` and `packages/core/tests/`).
