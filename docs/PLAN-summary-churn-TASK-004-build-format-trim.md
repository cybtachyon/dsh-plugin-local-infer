# TASK-004: build-format-trim

## Context

The `trailing-whitespace` prek hook currently absorbs any trailing whitespace tsc emits
into lib files. This task moves that normalization into the build pipeline:
`scripts/build-format.mjs` (the third step of `pnpm build`) will strip trailing
whitespace from the emitted files it already newline-normalizes, so the hook becomes a
no-op for lib files.

## Work

Extend `scripts/build-format.mjs`:

1. For each emitted file (`.js`, `.d.ts`, `.js.map`, `.d.ts.map` under `dsh` and
   `packages/*/lib`), strip trailing whitespace from every line in addition to the
   existing trailing-newline normalization.
2. Write the file back only when the content changed, so an idempotent run leaves
   mtimes and bytes untouched.
3. Keep the script's existing structure and style (node:fs/promises, concurrent walk).

Then verify:

4. `pnpm build` leaves the tree clean.
5. Idempotence: run `node scripts/build-format.mjs` twice; the second run changes
   nothing (`git status --short` stays clean, and a before/after `find ... -newer`
   check or byte comparison shows no writes).
6. Commit the script change.

## Definition of Done

- `scripts/build-format.mjs` strips per-line trailing whitespace and the trailing
  newline normalization is preserved.
- `pnpm build` leaves the tree clean; the script is idempotent.
- The change is committed.
