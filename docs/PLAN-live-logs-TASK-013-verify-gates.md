# TASK-013: Full gates and manual GUI verification

Dependencies: all tasks.

Definition of Done:

- [ ] `pnpm build` clean (tree left clean by `scripts/build-format.mjs`).
- [ ] `pnpm test` green; `pnpm test:coverage` clears the vitest.config.ts
      thresholds (lines 90 / functions 93 / branches 78 / statements 90).
- [ ] `pnpm lint` green; `prek run --files <changed paths>` green.
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
