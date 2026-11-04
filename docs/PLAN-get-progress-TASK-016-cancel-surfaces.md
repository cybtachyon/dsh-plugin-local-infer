# TASK-016: surface the Cancel affordance in three places

## Context

`performGetCancel` (TASK-015) is the driver. The request surfaces it in
three places, all while a Get run is in flight (the `'getting'` branch,
TASK-010):

1. A ghost Cancel `Button` in the title-bar `'getting'` branch, beside the
   busy Get control.
2. A ghost Cancel `Button` beside the busy Get button in `DepsPanel`.
3. A compact Cancel `Pill` in the Logs header (beside the step chips,
   TASK-014).

The existing provider-form Cancel (`cancelProvider`) stays the primary path.
The `Pill` and `Button` primitives come from the primitives seed
(TASK-017 adds `Pill` to `PrimitivesModule`); guard every use with a native
fallback.

## Change

- `packages/client/src/render/` (the title-bar control component that
  consumes the `'getting'` spec): add a ghost Cancel `Button` next to the
  busy Get control that calls `performGetCancel(store)`.
- `packages/client/src/render/DepsPanel.tsx`: beside the busy Get
  `renderProcessButton`, add a ghost Cancel `Button` (visible only while the
  get cell is pending) that calls `performGetCancel(store)`.
- `packages/client/src/render/LogsPanel.tsx`: add a compact Cancel `Pill` in
  the Logs header (visible only while a Get run is in flight) that calls
  `performGetCancel(store)`.
- `packages/client/src/text.ts`: add the cancel label keys (en + zh) if not
  already present (`cancel` already exists; reuse it).

## Definition of Done

- A test/render assertion: while a Get run is in flight, all three surfaces
  render a Cancel control wired to `performGetCancel`; when no run is in
  flight, none render.
- Every `Button` / `Pill` use is guarded with a native fallback.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- the title-bar control render component (under `packages/client/src/render/`)
- `packages/client/src/render/DepsPanel.tsx`
- `packages/client/src/render/LogsPanel.tsx`
- `packages/client/src/text.ts`
- the client render tests (under `packages/client/tests/`).
