# T2.2 `src/store/reducer.ts`.

Pure reducer for the whole action union.

**DoD:** unit tests per action family: `draft/edit` updates the field,
sets `dirty`, clears the save/deps/lifecycle notes; `summary/ack`
stores the summary, clears `getLogs`, and merges platform
field-level (local platform edits survive); `draft/discard` resets
draft from the summary and clears `dirty`; `launch/move` delegates to
`launchNextState` and stamps `startTime`; `action/ack` and
`action/fail` only apply while `pending` (late ack is a no-op);
`action/timeout` moves `pending -> error` with a timeout detail;
`pnpm build` green.
