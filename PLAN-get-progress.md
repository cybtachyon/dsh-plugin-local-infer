# PLAN: Get progress streaming

## Objective

Give the card live progress for long `hf` model downloads. Today the `hf` CLI
runs via `exec` with no `--format`, so its non-TTY default (`auto` → `agent`)
prints no progress at all: the Logs pane shows only the `$ hf download …`
header for a whole 100 GB download and the 120 s idle cap fires. This work
adds `--format human`, streams the tqdm stderr through a new `onChunk`
callback into the get-steps emit sink, carries a structured `{ progress }`
event, and renders it in the title bar, the provider row, and the Logs
header, plus a surfaced Cancel affordance.

## Verification guidelines

Repo gates (see AGENTS.md for the full build/test/lint commands): every
task's Definition of Done is verified with `pnpm build` (tsc -b + client
bundle), `pnpm test` (vitest run, coverage thresholds), and `pnpm lint`
(eslint, repo-wide). Host-side changes (service, ui route) activate only on a
host restart; client-side changes activate on a page refresh. A bundle with a
client half needs the bare-package carrier row (no-op `dsh/host.js`, root `.`
export, bundle row named after the bare package). Sub-packages import each
other by relative path, never a self-referencing bare specifier.

Task-specific checks:
- Server stream: the get route's text stream must carry the tqdm lines, so a
  streamed line re-arms the client idle cap.
- NDJSON: the launch route's stream must keep its `step` and `result` event
  contract; the new `progress` kind is additive and must not break the
  existing reader.
- Client: progress state rides the existing `ui/patch` action; the parser is
  pure and unit-tested; throttling is bounded (~2 Hz).
- Primitives: every new primitive use is guarded (`primitives &&
  typeof primitives.X === 'function'`) with a native fallback, because a
  missing seed is a fallback, not an error.

## Decisions (questionnaire answers)

1. **Get route stream format: NDJSON.** The get route (POST /local-infer/get)
   switches from plain text to NDJSON (the `RouteResponder.ndjsonStream()`
   opener already exists). It emits `{ log: string }` events for the log text
   (including the raw tqdm lines) and `{ progress: {…} }` events for
   structured progress. The client's `postGet` switches from
   `readTextStream` to an NDJSON reader (`readGetStream`) with `onChunk`
   (log) and `onProgress` callbacks. The persisted log file stays plain text
   (the route collects the log text separately from the NDJSON it writes).
2. **Progress event scope: both routes.** The `{ progress }` NDJSON event
   kind is emitted by both the get route and the launch route. A pure
   server-side tqdm parser (new `packages/core/src/progress.ts`, no node
   imports) is the single source of the parsing logic the routes use; the
   client's `parseHfProgress` (TASK-006) is the browser-side mirror (core is
   not browser-safe) and stays the parser the request names for populating
   `getProgress` from the streamed log text.
3. **Throttle cadence: 500 ms.** The `performGet` append closure throttles
   `getProgress` store updates to ~2 Hz (a 500 ms minimum interval); the
   latest state always lands on the final chunk and when the run settles.
4. **Step chips: as described.** Five Logs-header chips
   (deps / clone / build / model / template), toned success (done) / info
   (running, wrapped in `TextShimmer`) / quiet (not started) / danger
   (failed), the current step derived from the step-header lines get-steps
   already emits (`system dependencies`, `model download:`,
   `chat template:`, `get complete`) via a pure `deriveGetStep` helper.
5. **Title-bar branch: as described.** A new `'getting'`
   `LifecycleControlKind` branch in `deriveLifecycleControl` (a busy
   throbber with a live readout, distinct from the existing `'phase'`
   branch), with a custom thin CSS progress strip on `--dsw` tokens and a
   native fallback (the primitives package exports no `Progress` component).

## Task sequence

Grouped by phase. Each task is the smallest unit of work with a concrete,
verifiable Definition of Done (DoD). Refactor tasks review the files touched
by the previous commits in their phase and resolve the named code risks.

### Phase 1 — Server-side progress streaming

- [x] [TASK-001-add-format-human](docs/PLAN-get-progress-TASK-001-add-format-human.md)
- [x] [TASK-018-infernix-format-human](docs/PLAN-get-progress-TASK-018-infernix-format-human.md)
- [x] [TASK-002-spawn-runner-onchunk](docs/PLAN-get-progress-TASK-002-spawn-runner-onchunk.md)
- [x] [TASK-019-watchchildabort-sigterm](docs/PLAN-get-progress-TASK-019-watchchildabort-sigterm.md)
- [x] [TASK-020-providers-watchchildabort-sigterm](docs/PLAN-get-progress-TASK-020-providers-watchchildabort-sigterm.md)
- [x] [TASK-003-getsteps-onchunk-sink](docs/PLAN-get-progress-TASK-003-getsteps-onchunk-sink.md)
- [x] [TASK-021-infernix-progress-sink](docs/PLAN-get-progress-TASK-021-infernix-progress-sink.md)
- [x] [TASK-004-launch-route-progress-event](docs/PLAN-get-progress-TASK-004-launch-route-progress-event.md)
- [x] [TASK-005-refactor-phase1](docs/PLAN-get-progress-TASK-005-refactor-phase1.md)
- [x] [TASK-022-launch-logs-double-include](docs/PLAN-get-progress-TASK-022-launch-logs-double-include.md)

### Phase 2 — Client store progress state

- [x] [TASK-006-parse-hf-progress](docs/PLAN-get-progress-TASK-006-parse-hf-progress.md)
- [ ] [TASK-007-getprogress-state](docs/PLAN-get-progress-TASK-007-getprogress-state.md)
- [ ] [TASK-008-performget-throttle](docs/PLAN-get-progress-TASK-008-performget-throttle.md)
- [ ] [TASK-009-refactor-phase2](docs/PLAN-get-progress-TASK-009-refactor-phase2.md)

### Phase 3 — Provider title-bar progress readout

- [ ] [TASK-010-getting-control-branch](docs/PLAN-get-progress-TASK-010-getting-control-branch.md)
- [ ] [TASK-011-provider-row-readout](docs/PLAN-get-progress-TASK-011-provider-row-readout.md)
- [ ] [TASK-012-progress-strip-css](docs/PLAN-get-progress-TASK-012-progress-strip-css.md)
- [ ] [TASK-013-refactor-phase3](docs/PLAN-get-progress-TASK-013-refactor-phase3.md)

### Phase 4 — Current-Get-step indicator

- [ ] [TASK-014-logs-step-chips](docs/PLAN-get-progress-TASK-014-logs-step-chips.md)

### Phase 5 — Cancel affordance, surfaced

- [ ] [TASK-015-performgetcancel-driver](docs/PLAN-get-progress-TASK-015-performgetcancel-driver.md)
- [ ] [TASK-016-cancel-surfaces](docs/PLAN-get-progress-TASK-016-cancel-surfaces.md)

### Phase 6 — Primitives mapping

- [ ] [TASK-017-primitives-members](docs/PLAN-get-progress-TASK-017-primitives-members.md)

## Task dependencies

- TASK-018 depends on TASK-001 (the flag contract TASK-001 established in the
  core builders).
- TASK-002 depends on TASK-001 (the runner streams the command TASK-001 renders).
- TASK-019 depends on TASK-002 (the guard lives in the runner's abort wiring).
- TASK-020 depends on TASK-019 (the providers guard mirrors the service fix).
- TASK-003 depends on TASK-002 (the get-steps sink threads the onChunk the runner accepts).
- TASK-021 depends on TASK-003 (the Infernix chunks route through the sink TASK-003 added).
- TASK-004 depends on TASK-003 (the launch route emits progress from the get-steps run).
- TASK-005 depends on TASK-001..TASK-004 (reviews their commits).
- TASK-022 depends on TASK-005 (the double-include surfaced in the refactor's
  composeLaunchLogs / persistLaunchOutcome helpers).
- TASK-007 depends on TASK-006 (the state field is typed by the parser's output).
- TASK-008 depends on TASK-006 and TASK-007 (the throttle populates the field via the parser).
- TASK-009 depends on TASK-006..TASK-008 (reviews their commits).
- TASK-010 depends on TASK-008 (the branch reads the populated getProgress).
- TASK-011 depends on TASK-010 (the row readout mirrors the branch's readout).
- TASK-012 depends on TASK-010 (the strip renders inside the branch).
- TASK-013 depends on TASK-010..TASK-012 (reviews their commits).
- TASK-014 depends on TASK-008 (the chips derive the current step from the same log lines).
- TASK-015 depends on TASK-007 (the driver clears the getProgress field).
- TASK-016 depends on TASK-010 and TASK-015 (the surfaces hang on the branch and call the driver).
- TASK-017 is independent of the render tasks but must land before TASK-011,
  TASK-012, TASK-014, and TASK-016 consume Tag/Pill/TextShimmer; run it
  early in Phase 6 or fold its members in as each consumer lands.
