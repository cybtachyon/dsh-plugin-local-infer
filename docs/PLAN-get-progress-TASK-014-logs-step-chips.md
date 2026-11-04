# TASK-014: five `Tag` step chips in the LogsPanel header

## Context

`LogsPanel` in `packages/client/src/render/LogsPanel.tsx` renders the Logs
section (the read-only textarea, the auto-scroll, the chevron resize, and the
log-location field). The request wants five `Tag` step chips
(deps / clone / build / model / template) in the LogsPanel header, toned
success/info/quiet/danger, with the running one wrapped in `TextShimmer`.
The current Get step is derived from the step-header lines get-steps already
emits (`system dependencies`, `model download:`, `chat template:`,
`get complete`) via `deriveGetStep` (TASK-006).

The `Tag` and `TextShimmer` primitives come from the primitives seed
(TASK-017 adds them to `PrimitivesModule`); guard every use with a native
fallback.

## Change

- `packages/client/src/render/LogsPanel.tsx`:
  - Add a header row above the textarea with five `Tag` step chips
    (deps / clone / build / model / template).
  - Derive the current step from the displayed log text via
    `deriveGetStep` (TASK-006). Tone the chips: completed steps success, the
    running step info (wrapped in `TextShimmer`), not-yet-run steps quiet,
    and a failed step danger (when the run settled failed before that step
    completed).
  - Render the chips only while a Get run is in flight (the streamed buffer
    is active); with no run in flight the header shows nothing (or a quiet
    all-completed state).
- `packages/client/src/text.ts`: add the chip label keys (en + zh) for the
  five steps.

## Definition of Done

- A test/render assertion: with a streamed log that has reached the model
  step, the model chip is the running one (info tone, shimmer) and the
  earlier chips are success; with no run in flight the chips are absent.
- Every `Tag` / `TextShimmer` use is guarded with a native fallback.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/render/LogsPanel.tsx`
- `packages/client/src/text.ts`
- the client render tests (under `packages/client/tests/`).
