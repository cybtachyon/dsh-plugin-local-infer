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

## Scope note (achieved 2026-11-07)

The scope narrowed after TASK-006 (commit 3d29f81): the `SaveRequest
autoRebuild?: boolean` field (`packages/client/src/api/routes.ts`) and the
draft-rendered checkbox with its `draft/edit` dispatch (`packages/client/src/
Card.tsx`, `checked: currentDraft.autoRebuild ?? false`) landed together with
the store move, including the re-emitted `lib/` output. What this task added is
the card render tests in `packages/client/tests/card.spec.ts`: toggling writes
`autoRebuild: next` through `draft/edit` and marks the form dirty; opening two
providers (one stored `true`, one stored without the key) shows each one's own
box; a fresh new-provider draft (key absent) draws unchecked. Located through
the Auto Rebuild label's own text, not a checkbox index.
