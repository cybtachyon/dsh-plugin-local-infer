# TASK-001: restructure-meter-call

## Context

`packages/ui/lib/viewmodels/summary.js` churns 2 lines on every tsc re-emit of the ui
package. The content line: tsc collapses the multi-line `renderMeter(` call in
`packages/ui/src/viewmodels/summary.ts` onto one line and emits a trailing space after
`estimate.reserveSource,`; the `trailing-whitespace` prek hook strips that space at
commit time, so the committed file drifts from what tsc emits. (The second churned line
is the repo-wide trailing-newline delta, already normalized by
`scripts/build-format.mjs`.)

## Work

In `packages/ui/src/viewmodels/summary.ts`, the `renderMeter(` call inside the `return`
object carries an inline comment block between `estimate.reserveSource,` and the final
argument `anyUnsure ? { bytes: estimate.breakdown.reserve } : null`.

1. Hoist the final argument into a named local declared after `anyUnsure` and
   `estimate` are computed and before the `return` statement. Move the comment block
   with it, verbatim.
2. Pass the local as the final `renderMeter(` argument, so the argument list carries
   no inline comment.
3. Review the existing names in the file before proposing the local's name; it must be
   accurate and consistent with the surrounding naming.

Then re-emit and commit:

4. Run `pnpm build` (tsc + build-client + build-format) and confirm `git status --short`
   is clean.
5. Commit the source change plus any re-emitted lib artifacts.

## Definition of Done

- `npx tsc -b --force` emits `packages/ui/lib/viewmodels/summary.js` with no trailing
  whitespace: `grep -n ' $' packages/ui/lib/viewmodels/summary.js` prints nothing.
- The `renderMeter(` call in the source carries no in-list comment.
- `pnpm build` leaves the tree clean; the work is committed.
