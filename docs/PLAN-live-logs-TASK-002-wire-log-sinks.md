# TASK-002: Wire all provider-process outputs through the run-log service

Dependencies: TASK-001.

Every stateful provider process begins a run on the service and streams its
output into it, keyed per TASK-001's rule:

- `packages/ui/src/routes/get.ts`: the route's `log` sink appends every
  chunk to `appendRunLog` in addition to streaming; `beginRun` before the
  run with the `--- Getting engine and model...` seed, `endRun` after
  `finishRunSection`.
- `packages/ui/src/ops/engine.ts` `launchEngine`: the `appendGetLogs` sink
  and the deploy-step output (the result's `buildLogs` / engine `logs` as
  they become available) append to the run buffer; seed
  `--- Launching...`; end at settle (healthy, failed, canceled).
- `packages/ui/src/routes/download.ts` and `chat-template.ts`: begin the run
  (`--- Downloading...`), stream the hf command line and the CLI output (the
  command-line logging itself lands in TASK-007; here just route whatever
  the run produces through the buffer), end at settle.
- `packages/ui/src/routes/install.ts`: begin (`--- Installing deps...`),
  append the per-dep install results, end at settle.
- `packages/ui/src/routes/stop.ts`: begin (`--- Stopping...`), append the
  stop failure note when one happens, end at settle.
- Keep `lastLogs` (config.json) and the per-run log file as the after-reload
  read model, unchanged; the run-log buffer is the live read model. Do not
  let a third copy of the text appear: derive both from the same chunks the
  route already collects.

Definition of Done:

- [x] Each route/op above begins, appends, and ends exactly one run per
      process, including the cancel and failure paths (a `finally`).
- [x] Tests: each route test with a stub host asserts the buffer for the
      right key holds the run's text in order and the running flag settles;
      a concurrent run under another key does not interleave.
- [x] `pnpm build` and `pnpm test` green.
