# TASK-005: Single streamed display path for the Logs textarea

Dependencies: TASK-004. Questionnaire Q2: all log updates stream; the Get
route's own stream no longer carries log lines.

Make the textarea's in-flight text come from exactly one streamed source,
and after settle from `summary.lastLogs`:

- `packages/ui/src/routes/get.ts`: drop the `{ log }` NDJSON events from
  the Get route's answer (the logs stream route carries the text); keep
  `progress` events and the final settle on the existing Get response. The
  client's `readGetStream` reader loses its log-chunk path and keeps the
  progress path.
- `packages/client/src/store/derive.ts` `deriveDisplayedLogs`: read the one
  live buffer field while any provider process is in flight or one settled
  mid-session; otherwise the stored `lastLogs`. Rename the buffer field in
  `LogsPaneState` (`packages/client/src/store/types.ts`) from `getLogs` to
  a process-neutral name (`liveLogs`).
- Remove the now-duplicated client-side seeds (`seedProcessLog` seeds the
  separator the host's `beginRun` now owns and streams as `runBegin`) so a
  line never lands twice; keep `appendCanceledLog` (instant client-side
  "Canceled" feedback; the host persists its own copy in the run).
- `packages/client/src/render/LogsPanel.tsx`: keep auto-scroll, chips,
  Cancel pill; the chips' in-flight condition follows the unified live
  state, not only the Get cell, and the Get chips keep pricing off the
  streamed text lines.
- Fix the discovered reducer flaw (`packages/client/src/store/reducer.ts`,
  summaryAck always clears `ui.logs.getLogs`): a summary ack during a live
  run (the stop fast-poll, a debounced re-price) must NOT wipe the attached
  live buffer; clear only when nothing is attached/in flight. Test: stream
  two lines, ack a summary, assert the buffer survived; ack again after
  runEnd, assert the fallback to `lastLogs`.
- Wire the missing driver: `performDraftStop` gets the one-line
  beginRun/endRun attach pair (same key rule), so the pane follows draft
  stop output.
- Remove the now-redundant `seedProcessLog` client seeds (the host
  `beginRun` seed arrives as `runBegin`/snapshot).
- Update `packages/client/tests/logspanel.spec.ts`, `derive.spec.ts`,
  `deps.spec.ts`, `sync.spec.ts` and the `routes.spec.ts` stream reader
  tests.

Definition of Done:

- [ ] One display path; no double-append (a test renders a full fake run
      over the stream and asserts each line appears once).
- [ ] The Get run's readout chips and progress strip still work with the
      log events removed from the Get response.
- [ ] Auto-scroll and Cancel behavior tests still pass; chip visibility
      covers the launch process too.
- [ ] `pnpm build` and `pnpm test` green.
