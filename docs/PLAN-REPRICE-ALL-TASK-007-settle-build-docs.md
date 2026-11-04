# TASK-007: Settle the remaining pre-existing build and doc issues

Discovered during TASK-006. Four items.

1. **Duplicate newline normalization (multiple sources of truth).**
   `scripts/build-format.mjs` (the third step of the root build chain,
   `tsc -b && node scripts/build-client.mjs && node scripts/build-format.mjs`)
   already appends trailing newlines to `.js` / `.d.ts` files in `dsh` and
   every `packages/*/lib`. TASK-006 added a second, overlapping walk of
   `packages/client/lib` to `scripts/build-client.mjs`. Resolve:
   - In `scripts/build-format.mjs`, extend the extension filter to also
     cover the map files (`.js.map`, `.d.ts.map`).
   - In `scripts/build-client.mjs`, remove the client-lib walk added by
     TASK-006 (drop the `readdirSync` / `statSync` imports and the
     normalization block, restore the "Two steps" header doc).
   The single normalization step then covers every lib directory, maps
   included.
2. **AGENTS.md build pipeline doc gap.** The "client build pipeline"
   section lists only `tsc -b` + `build-client.mjs`. Add the third step
   (`node scripts/build-format.mjs`, the trailing-newline normalization of
   the emitted lib artifacts).
3. **AGENTS.md prek CLI note.** The Testing section says "Run `prek`
   before committing" with no exact CLI. The installed prek uses
   `prek run --files <paths>` (not `--filename`). Record the exact
   invocation.
4. **`packages/ui/lib/viewmodels/summary.js` content churn (document,
   do not fix).** tsc re-emits a collapsed `renderMeter(` call and a
   trailing space the hooks had normalized, so a ui-package re-emit shows
   a 2-line diff. A post-build formatter pass is a bigger tooling change
   out of scope here; the hooks absorb it on commit (already noted in the
   engramory memory). Record it as a known issue in
   `PLAN-REPRICE-ALL.md` (a "Known pre-existing issues" section), not in
   the source.

## Definition of Done

- `scripts/build-format.mjs` normalizes `.js`, `.d.ts`, `.js.map`, and
  `.d.ts.map` files; `scripts/build-client.mjs` has no normalization walk.
- `pnpm build` twice in a row: after the second run,
  `git status --short` shows no `packages/*/lib` or `dsh` changes.
- AGENTS.md documents the three-step build chain and the exact prek
  invocation.
- `PLAN-REPRICE-ALL.md` carries the known-issue note for the summary.js
  churn.
- Committed with the message
  `fix(build): single lib newline normalization and the AGENTS.md build docs`.
