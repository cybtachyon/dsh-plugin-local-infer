# TASK-007 - Card checkbox renders from the draft; SaveRequest carries autoRebuild

Wire the visible control to the per-provider value.

- Files: `packages/client/src/Card.tsx` (the `renderCheckbox` near
  `t.autoRebuild`), `packages/client/src/api/routes.ts` (`SaveRequest`).
- Checkbox: `checked: state.draft?.autoRebuild ?? false`; onChange dispatches a
  `draft/edit` carrying the current draft with `autoRebuild: next` (the field-
  edit pattern the parameter fields use; it marks the form dirty, so a changed
  checkbox reads as an unsaved provider change until Save).
- `SaveRequest`: add `autoRebuild?: boolean`.
- DoD: card render test toggling the checkbox flips the draft value and marks
  dirty; switching between two providers shows each one's own value. Commit with
  the re-emitted `lib/` output (the `dsh/client.js` artifact lands in TASK-009's
  build if not here).
