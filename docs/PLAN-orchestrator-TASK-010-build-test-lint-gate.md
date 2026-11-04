# TASK-010: Build / test / coverage / lint gate

Run the full repo gates and resolve everything they report:

- `pnpm build`
- `pnpm test`
- `pnpm test:coverage` clearing the vitest.config.ts thresholds (lines 90 /
  functions 93 / branches 78 / statements 90); add missing specs only where
  the thresholds demand it.
- `pnpm lint`
- `prek run --files <changed paths>`

Definition of Done: all five gates pass on the tree (pre-existing unrelated
dirty files left untouched); report the coverage percentages in the final
summary; no commit unless a gate required a fix.

## Answered open questions

(none specific to this task)
