# TASK-013: Full gates and manual GUI verification

Dependencies: all tasks.

Definition of Done:

- [x] `pnpm build` clean (tree left clean by `scripts/build-format.mjs`).
- [x] `pnpm test` green; `pnpm test:coverage` clears the vitest.config.ts
      thresholds (lines 90 / functions 93 / branches 78 / statements 90).
- [x] `pnpm lint` green; `prek run --files <changed paths>` green.
- [ ] `pnpm build`, restart dsh, refresh the GUI at http://127.0.0.1:3080.
- [ ] Manual observation (record what was seen in this file):
  - [ ] Launch a provider with an uncached model: the Logs textarea appends
        new lines while prereqs, clone/build, the hf model download, the
        deploy, and the health poll each run (not only at completion).
  - [ ] The entry's button reads Downloading... (not Prereqs...) while the
        hf CLI downloads; Building... during the build; Launching... during
        the health poll.
  - [ ] A model Download button run and a deps Install run show their
        `$ <command>` lines and streamed output in the Logs section while
        running.
  - [ ] The health-poll URL line appears once before the verdict.
  - [ ] A Get run still streams live as before.
  - [ ] A second concurrent provider run does not interleave logs into the
        first provider's pane target.

## Gate results (2026-11-06)

Run from a clean tree at 69aa3ee (all automated gates only; the GUI items
below stay open for a human because this agent session runs inside the dsh
host, so a restart here would kill the session and the running host still
serves the pre-restart code).

- `pnpm build`: exit 0. `tsc -b`, then `scripts/build-client.mjs` wrote
  `dsh/client.js` (149142 bytes), then `scripts/build-format.mjs`.
  `git status --porcelain` after the build is empty: the tracked `lib/`
  outputs and `dsh/client.js` are committed and the build causes no churn.
- `pnpm test` (`vitest run`): exit 0. 90 test files passed (90), 1670 tests
  passed (1670), duration 1.17 s.
- `pnpm test:coverage`: exit 0. All files totals: statements 95.30 /
  branches 84.86 / functions 95.05 / lines 95.87, clearing the
  `vitest.config.ts` thresholds (statements 90 / branches 78 /
  functions 93 / lines 90).
- `pnpm lint` (`eslint .`): exit 0, no findings.
- `prek run --files docs/PLAN-live-logs-TASK-013-verify-gates.md`: exit 0.
- Consistency sweep: PLAN-live-logs.md rows TASK-001 through TASK-012 are
  all `[x]` and every one of their task files has all DoD boxes `[x]`; no
  stragglers found.

## How to verify manually

1. `pnpm build`.
2. Restart dsh (host-side packages and the rebuilt `dsh/client.js` card
   artifact load at startup; a page refresh alone is not enough).
3. Refresh http://127.0.0.1:3080.
4. Observation checklist (check the Manual observation boxes above as each
   is seen):
   - Launch a provider with an uncached model: the Logs textarea appends
     new lines while prereqs, clone/build, the hf model download, the
     deploy, and the health poll each run (not only at completion).
   - The entry's button reads Downloading... (not Prereqs...) while the
     hf CLI downloads; Building... during the build; Launching... during
     the health poll.
   - A model Download button run and a deps Install run show their
     `$ <command>` lines and streamed output in the Logs section while
     running.
   - The health-poll URL line appears once before the verdict.
   - A Get run still streams live as before.
   - A second concurrent provider run does not interleave logs into the
     first provider's pane target.
