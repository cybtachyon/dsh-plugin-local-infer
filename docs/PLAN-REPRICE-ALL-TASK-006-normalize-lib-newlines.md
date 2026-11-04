# TASK-006: Stop the recurring lib map-file newline churn

Pre-existing issue discovered during TASK-002: four files under
`packages/client/lib` (`Card.d.ts.map`, `Card.js.map`, `index.d.ts.map`,
`plugin.d.ts.map`) are committed with a trailing newline (the
end-of-file-fixer hook adds it on commit), but `tsc -b` re-emits them
without one. Every `pnpm build` marks them dirty, and the hook silently
restores the newline on the next commit.

Fix (chosen over leaving it to the hook, or excluding the files from the
hook): in `scripts/build-client.mjs`, after the bundle step, normalize the
trailing newlines of the re-emitted `packages/client/lib/**` text files:
walk the directory recursively, and for each regular file whose content
does not end with `\n`, append one. The build output then matches the
committed state byte-for-byte, so `pnpm build` leaves the tree clean and
the hook no longer fires on the map files.

## Definition of Done

- `scripts/build-client.mjs` normalizes the trailing newlines of
  `packages/client/lib/**` after the bundle step, with a comment naming
  the reason (tsc drops the trailing newline the end-of-file-fixer hook
  adds on commit).
- `pnpm build` twice in a row: after the second run,
  `git status --short` shows no `packages/client/lib` changes.
- Committed with the message
  `fix(build): normalize the lib trailing newlines so the build leaves the tree clean`.
