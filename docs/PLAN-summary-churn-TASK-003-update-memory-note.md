# TASK-003: update-memory-note

## Context

The engramory memory note
`/home/derek/.dsh/.engramory-memory/dsh-local-infer-build-newline-churn.md` records the
`summary.js` 2-line variant as unfixed ("The ui lib variant below is unfixed."). The
fix (TASK-001) and the hardening (TASK-004) are now in; the note must be updated in
place, not duplicated.

## Work

1. Update the note's Variant section: state the variant is fixed, name the fix
   (the hoisted local in the `renderMeter(` call) and the hardening
   (`scripts/build-format.mjs` now strips trailing whitespace), with pointers to the
   fix commits (commit subjects are enough; the note stores stable pointers, not
   current state).
2. Bump the `updated:` frontmatter date to today.
3. Keep the note's existing structure and the other sections (the newline-churn
   history) intact.

The memory store is outside the repo; no git commit is needed for this task.

## Definition of Done

- The Variant section states the variant is fixed, with commit pointers.
- The `updated:` date is current.
- No other note was created or modified.
