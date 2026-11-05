# TASK-005 Get route sudo note

- [x] Done.

**Phase 2. Depends on TASK-004. Definition of Done: `pnpm vitest run packages/ui`
passes and `pnpm lint` is clean.**

A standalone Get runs the same system-dependency install a launch does, so it
must print the same note through the same code path. In
`packages/ui/src/ops/engine.ts` `getEngine`:

- Register the same sudo observer for the run's duration (extract the
  register/notify/persist/unregister sequence TASK-004 introduced into one
  local helper the two operations share, so the note rule has one home).
- The Get route's answer is a plain-text stream the card appends raw to the
  Logs textarea, so the observer writes the note through the run's existing
  `log` sink as `!! ` + `SUDO_CLI_NOTE` + `\n`, the same `!!` prefix the Get
  step's own failure lines use. It also persists through `persistProcessLog`.
- No control-state event: the card's Get control keeps its 'getting' throbber.

Add a `packages/ui/tests/route.spec.ts` case: a Get run whose host reports a
sudo prompt streams the note line into the text body and persists it.
