# TASK-06 - Full verification

- `pnpm build` (tsc emit + client bundle + format + verify-emit).
- `pnpm test` full suite green.
- `pnpm test:coverage` clears the vitest.config.ts thresholds (lines 90 /
  functions 93 / branches 78 / statements 90).
- `pnpm lint` clean.
- `prek run --files <changed paths>` (the installed prek takes `--files`).
- Confirm the committed `lib/` emit carries the source changes (grep the
  changed symbol in the emitted file, per the repo's stale-emit trap), and
  commit any remaining emit with an explicit file list (never `git add -A`).

Definition of Done: every command above exits 0, with the real output quoted
in the final report.
