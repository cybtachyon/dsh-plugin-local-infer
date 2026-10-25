# T3.9 Replace the hand-written artifact.

`dsh/client.js` is now
generated only; confirm the old hand-written body is gone from the file
and the generated header is present.

**DoD:** `pnpm build` regenerates the file; `node --check` green; the
GUI card is fully functional (see the GUI walkthrough checklist in
PLAN.md); `git diff` shows `dsh/client.js` as a generated replacement.
