# PLAN-sudo-launch-prompt

Sudo password prompts land on the terminal that launched the running web
profile, where the user cannot see them. When a launch (or a Get) runs a sudo
command that has no cached credentials, both Launch buttons must read
"Sudo needed", the line `Check your CLI for a sudo prompt` must appear in the
Logs section textarea and the logs file, and after 60 seconds without a
password the run must kill the process and fail through the existing
error-to-Logs path so the buttons become "Logs".

## Verification guidelines

- Never run a real `sudo` in a test. Drive the guard with an injected probe, an
  injected timer, and a stubbed child; the pure rule lives in core where a
  table test covers it.
- Behavior is verified per layer: core (`vitest packages/core`), the guarded
  runners (`packages/service`, `packages/providers`), the streamed event and the
  persisted note (`packages/ui`), the control state (`packages/client`).
- The final gate set is the one AGENTS.md names: `pnpm build`, `pnpm test`,
  `pnpm test:coverage`, `pnpm lint`, `prek run --files <paths>`.
- A client change is live after a page refresh; a host-side change needs a
  bundle reinstall or plugin toggle plus a host restart. Report which half each
  task touched.
- Manual confirmation (user action, not agent): `sudo -k` in a shell, then press
  Launch in the card at <http://127.0.0.1:3080> and watch the button read
  "Sudo needed", the note line appear, and the run fail at 60 s.

## Questionnaire

Answers are recorded at the bottom of this file. See
[ask_user_question items](#answers) for the settled choices.

## Task dependencies

- TASK-001 has no dependency.
- TASK-002 depends on TASK-001 (imports the core rule).
- TASK-003 depends on TASK-001 and TASK-002 (imports the guard binding and the
  service seam).
- TASK-012 depends on TASK-002 and TASK-003 (it publishes the seam they use).
- TASK-004 depends on TASK-012 (the notify must reach the service).
- TASK-005 depends on TASK-004 (shares the observer helper).
- TASK-006 depends on TASK-004 (the event shape the client must read).
- TASK-007 depends on TASK-006.
- TASK-008 depends on TASK-007.
- TASK-009 depends on TASK-001 .. TASK-008.
- TASK-010 depends on TASK-009.

## Tasks

### Phase 1: the host rule

 - [x] [TASK-001-core-sudo-primitives](docs/PLAN-sudo-launch-prompt-TASK-001-core-sudo-primitives.md)
 - [x] [TASK-002-service-sudo-seam](docs/PLAN-sudo-launch-prompt-TASK-002-service-sudo-seam.md)
 - [x] [TASK-003-host-guard](docs/PLAN-sudo-launch-prompt-TASK-003-host-guard.md)

### Phase 2: routes, stream events, persistence

 - [x] [TASK-012-publish-notify-seam](docs/PLAN-sudo-launch-prompt-TASK-012-publish-notify-seam.md)
 - [ ] [TASK-004-launch-route](docs/PLAN-sudo-launch-prompt-TASK-004-launch-route.md)
 - [ ] [TASK-005-get-route-note](docs/PLAN-sudo-launch-prompt-TASK-005-get-route-note.md)

### Phase 3: the card control

 - [x] [TASK-006-machine-state](docs/PLAN-sudo-launch-prompt-TASK-006-machine-state.md)
 - [x] [TASK-007-client-driver](docs/PLAN-sudo-launch-prompt-TASK-007-client-driver.md)
 - [x] [TASK-011-sudo-deadline-ownership](docs/PLAN-sudo-launch-prompt-TASK-011-sudo-deadline-ownership.md)
 - [x] [TASK-008-control-label](docs/PLAN-sudo-launch-prompt-TASK-008-control-label.md)

### Phase 4: build and gates

 - [ ] [TASK-009-build-gates](docs/PLAN-sudo-launch-prompt-TASK-009-build-gates.md)

### Phase 5: refactor

 - [ ] [TASK-010-refactor](docs/PLAN-sudo-launch-prompt-TASK-010-refactor.md)

## Carried issues for TASK-010

- The sudo kill signals the spawned shell with SIGTERM only. A simple
  `sudo ...` line in dash execs, so sudo itself dies; a compound line
  (`a && sudo b`) leaves sudo as a survivor. A process-group kill (detached
  spawn plus `kill(-pid)`) is the review candidate.
- Any `tsc -b` of a dependent project re-dirties its tracked `lib/` outputs with
  trailing-newline-only diffs; `scripts/build-format.mjs` inside `pnpm build` is
  the canonical normalization, so run the full build last.
- `performDiscard` (`packages/client/src/store/actions.ts`) and
  `deleteProvider`'s form-collapse path abandon the draft form without clearing
  `ui.sudoPending`, the gap TASK-011 closed only inside
  `packages/client/src/store/providers.ts`. Route every draft-abandon path
  through one clear-the-flag helper.
- A sudo wait that resumes must hand the deadline back to the health cap
  (TASK-011). Confirm the single-owner rule survives the refactor: no second
  timer, no re-armed sudo deadline.
- Both `packages/ui` service stubs are cast (`as unknown as
  LocalInferService`), so widening the interface is invisible to the type
  checker and a missing member only fails at runtime in a route. Type one stub
  without the cast, or add a `satisfies` check.
- The service sudo guard signals the spawned shell only. A process-group kill
  (detached plus `kill(-pid)`) belongs there too now that the providers host
  shares `signalChild`; the two kill paths should end up on one rule.

## Answers

1. Sudo detection. No string parsing. The dependency data already carries the
   fact: `SystemDep.requiresSudo` drives the install path, and the one
   hand-written `sudo ln -sf` line declares it at its own call site through a
   new `RunOptions.needsSudo` flag. See
   [TASK-001](docs/PLAN-sudo-launch-prompt-TASK-001-core-sudo-primitives.md).
2. Probe. Yes. Before a declared-sudo command the runner asks
   `sudo -n true`; a clean exit means cached or NOPASSWD credentials, so no
   announcement and no 60 second cap.
3. Buttons. The two the derivation already syncs: the control at the end of the
   open settings form and the provider entry's Launch button. Both read the
   per-provider launch machine, so one `sudo` status paints both. The
   fresh-draft form control is labelled too, through one new store flag.
4. Get scope. Yes, a standalone Get's dependency install shares the guard, the
   note, and the 60 second failure. Its control keeps the 'getting' throbber.
5. Look. The button's text color goes dark orange in the "Sudo needed" state,
   through the design token `--dsw-alias-state-warn-primary` (fallback
   `--dsw-alias-label-warning`, then `#ff9f0a`), declared once in
   `packages/client/src/styles.ts` and read by both renderers.
6. Card timer. Yes. The host kills the process at 60 seconds; the card also
   arms a 65 second deadline that settles the control through the same
   failed-to-Logs path the health-poll timeout uses.
