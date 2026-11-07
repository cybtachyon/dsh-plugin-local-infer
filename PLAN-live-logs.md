# PLAN: Live per-provider run logs and Launch-state truth

Objective: the card's Logs section must show, live and at a regular interval,
what a stateful provider process (Get, Launch, Prereqs, Download, Install,
Stop) is doing at any moment, every exec / URL query must log its command /
URL before running and append its results after, and the Launch-button text
must always match the provider process actually running.

## Root causes found during analysis

- The launch route streams only `step` / `progress` / `sudo` / `result`
  NDJSON events, never log text. `launchEngine` collects the Get-steps output
  in a server-side `getLogs` closure and persists it only at two milestones
  (`persistStoredLogs` before deploy, `persistLaunchOutcome` at settle), so
  the Logs textarea stays on the previous run until the whole launch settles.
- The Get route streams log lines live, but display is bound to the client's
  streamed `ui.logs.getLogs` buffer; the download / chat-template routes
  persist one completion line (the `hf` command itself never reaches the
  log), and the install route never logs the install command lines it runs.
- `launchEngine` announces `prereqs` at start and then runs the Get steps
  (which include the multi-minute `hf` model download) with no further step
  events until the adapter's deploy, so the button reads "Prereqs..." while
  the hf CLI downloads a model.
- The machine's forward-only guard (`LAUNCH_STEP_ORDER` prereqs < download <
  build < launch) contradicts the real sequences (Get steps: deps, clone,
  build, model download; llamacpp deploy: download, build), so a truthful
  late `download` step event would be dropped as out-of-order.

## Verification guidelines

- Repo gates per AGENTS.md are the floor: `pnpm build`, `pnpm test`,
  `pnpm test:coverage` (thresholds 90/93/78/90), `pnpm lint`,
  `prek run --files <paths>` before each commit.
- Host-side changes activate via `pnpm build` + dsh restart (the profile
  install is a repo symlink); the rebuilt `dsh/client.js` card artifact also
  needs the host restart (boot-composed rev), not just a page refresh.
- Route-level smoke test after Phase 1: from the GUI session (or a `curl -N`
  with the session cookie), GET
  `http://127.0.0.1:3080/local-infer/logs?provider=<key>` opens an NDJSON
  stream: a first `snapshot` event, then one `log` event per append while a
  run is in flight.
- GUI observation (Phase 5): launch a provider whose model is not cached and
  confirm (a) the Logs textarea appends during prereqs, clone/build, model
  download, deploy, and health poll, (b) the entry's button text tracks the
  actual process (Downloading... while the hf CLI runs), (c) each exec line
  appears as `$ <command>` before its output.
- Every task keeps the Vitest suite green; new behavior lands with tests in
  the owning package's `tests/` directory.

## Open questions (answered in the Questionnaire section below)

1. Poll cadence for the Logs textarea while a provider process runs and the
   Logs section is open.
2. Whether the Get route's streamed log lines keep feeding the textarea, or
   all live log display moves to the per-provider logs route.
3. What the single Logs textarea shows when several providers run at once.
4. How to reconcile the machine's forward-only step guard with the real
   step sequences.

## Micro-tasks

### Phase 1: Host shared run-log service

- [x] [TASK-001-run-log-service](docs/PLAN-live-logs-TASK-001-run-log-service.md)
  Add the per-key run-log hub (begin/append/subscribe/read-snapshot/end,
  bounded tail, running flag, reset detection) to `LocalInferService`, keyed
  by provider id with an engine-id fallback rule shared by all run paths.
- [x] [TASK-002-wire-log-sinks](docs/PLAN-live-logs-TASK-002-wire-log-sinks.md)
  Route every provider-process output (get, launch Get-steps, deploy output,
  download, chat-template, install, stop) through the run-log service; keep
  the stored `lastLogs` and log-file persistence as the after-reload read
  model with one source of truth for the text.
- [x] [TASK-003-logs-route](docs/PLAN-live-logs-TASK-003-logs-route.md)
  Add `GET /local-infer/logs?provider=<key>` as an NDJSON **stream** (per
  Q2: streaming, not polling): a first `{ snapshot, seq, running }` catch-up
  event, then one `{ log }` event per append; register it with the other
  routes.

### Phase 2: Client live Logs

- [x] [TASK-004-client-logs-stream](docs/PLAN-live-logs-TASK-004-client-logs-stream.md)
  Add `subscribeRunLogs` plus store wiring: while a stateful provider
  process runs (launch, get, download, install, stop) and the Logs section
  is mounted, the card holds the per-provider NDJSON stream open and
  appends each `log` event to the live buffer (snapshot catch-up on attach,
  e.g. after a page refresh mid-run); close cleanly on settle / cancel /
  unmount.
- [x] [TASK-005-logs-display-path](docs/PLAN-live-logs-TASK-005-logs-display-path.md)
  Make the textarea's in-flight text come from the one streamed
  run-log path: the Get route's NDJSON drops its `log` events (the logs
  stream carries them), the Get stream keeps carrying progress/result, and
  the duplicated client-side seeds the server now owns are dropped;
  preserve auto-scroll, chips, and the Cancel pill.
- [x] [TASK-006-refactor-logs](docs/PLAN-live-logs-TASK-006-refactor-logs.md)
  Refactor: review the files touched by the previous 5 tasks and resolve the
  smells checklist.

### Phase 3: Exec / URL logging audit

- [x] [TASK-007-exec-command-logging](docs/PLAN-live-logs-TASK-007-exec-command-logging.md)
  Audit every exec site (service `runCommand` / `guardedShellRunner` /
  download runner spawn, providers' git sync + build, engine adapters'
  compose up/down, systemDeps probes); every mutating command writes
  `$ <command>` to the log first and appends output after; move the
  `$ hfDownloadCommand(...)` lines from `get-steps.ts` to the exec sites so
  all callers log once and never twice.
- [x] [TASK-008-url-audit](docs/PLAN-live-logs-TASK-008-url-audit.md)
  Audit URL queries (health-poll `host.fetch(plan.healthUrl)` in
  adapters.ts + strataAdapter.ts, and any other host fetch): write the URL
  to the log before the first request, append the settled outcome; document
  read-only probe exclusions.

### Phase 4: Launch-button / process alignment

- [ ] [TASK-009-step-events-real-order](docs/PLAN-live-logs-TASK-009-step-events-real-order.md)
  Emit launch step events for the real phases in real order (prereqs only
  while deps install runs; build on clone/build; download on model/template
  download) and update the machine per the Q4 answer so the button leaves
  "Prereqs..." while the hf CLI downloads.
- [ ] [TASK-010-displaytext-mapping](docs/PLAN-live-logs-TASK-010-displaytext-mapping.md)
  Move the state-to-label mapping into the machine as a `displayText` table
  (logical machine names, short user-friendly labels); `phaseLabelFor`,
  ProviderList, and the title-bar control consume it; no renderer hardcodes
  a phase label.
- [ ] [TASK-011-button-audit](docs/PLAN-live-logs-TASK-011-button-audit.md)
  Audit the remaining process-vs-button mismatches (entry row of a second
  running entry, download / chat-template / install cells, the `downloading`
  re-poll path, `stopping`); fix each or record the reason it stays.
- [ ] [TASK-012-refactor-state](docs/PLAN-live-logs-TASK-012-refactor-state.md)
  Refactor: review the files touched by the previous 5 tasks and resolve the
  smells checklist.

### Phase 5: Verification

- [ ] [TASK-013-verify-gates](docs/PLAN-live-logs-TASK-013-verify-gates.md)
  Full repo gates green (build, test, coverage thresholds, lint, prek) and
  the manual GUI observation checklist from the Verification section.

## Task dependencies

- TASK-001: none.
- TASK-002: TASK-001.
- TASK-003: TASK-001, TASK-002.
- TASK-004: TASK-003.
- TASK-005: TASK-004, Questionnaire Q2.
- TASK-006: TASK-001 through TASK-005.
- TASK-007: TASK-006.
- TASK-008: TASK-007.
- TASK-009: TASK-008, Questionnaire Q4.
- TASK-010: TASK-009.
- TASK-011: TASK-010.
- TASK-012: TASK-007 through TASK-011.
- TASK-013: all tasks.

## Questionnaire answers (2026-11-06)

### Q1: Poll cadence

1 second. Superseded by the Q2 decision: the card holds a streaming NDJSON
connection per provider instead of polling, so no client poll timer exists;
the 1 s figure stays only as a possible server-side flush/throttle ceiling
if a chatty writer needs one (not built unless needed).

### Q2: Get-route log display

User decision (custom): "Switch this up, instead of polling, change all Log
updates to streaming NDJSON." All log display (Get, Launch, Download,
Install, Stop) flows through the shared per-provider run-log service, and
the per-provider logs route answers as an NDJSON stream. The Get route's
own NDJSON stream keeps only progress/result events.

### Q3: Logs pane target with concurrent providers

Edited provider, else the latest started run. The route stays per-provider,
so a later per-entry log view is a pure UI addition.

### Q4: Step guard reconciliation

Server stream is authoritative: a live step event sets the reported phase
directly (stop-in-flight still supersedes late steps; unknown names stay
no-ops); the static forward-only order is dropped.
