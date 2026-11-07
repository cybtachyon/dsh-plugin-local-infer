# TASK-003: GET /local-infer/logs NDJSON stream route

Dependencies: TASK-001, TASK-002. Questionnaire Q2: the per-provider route
streams; the client does not poll.

Add the streaming route the client attaches to, per the existing
`defineRoute` template and `ndjsonStream()` responder, in a new file
`packages/ui/src/routes/logs.ts`:

- `GET /local-infer/logs?provider=<key>`:
  1. Open the NDJSON stream.
  2. Read the current buffer (`readRunLog`) and write one catch-up event:
     `{ snapshot: "<bounded buffer text>", seq, running }`.
  3. Subscribe (`subscribeRunLog`) and write one `{ log: "<chunk>" }`
     event per append; write `{ runEnd: true }` when the run ends.
  4. On the response's client disconnect (`onClose`), dispose the
     subscription. A client that stays attached across runs receives the
     next `beginRun` as a `{ runBegin: "<seed>", seq }` event, so the
     attached pane replaces its buffer instead of appending.
  - An unknown key streams the empty snapshot with `running: false` and
    stays attached (not a 404, so a client racing a run start never
    errors).
- Register `logsRoute(localInfer)` in `registerLocalInferRoute`
  (`packages/ui/src/route.ts` routes list).
- Export the event union type from the ui package's public types so the
  client mirror has one source (the client bundle mirrors interfaces by
  hand, per the bundle-external rule; keep a comment linking the host file).

Definition of Done:

- [x] Route file, registration, and typed event union exported.
- [x] `packages/ui/tests/` route tests (fake response with write/on):
      snapshot-first ordering, live appends streamed, runEnd streamed,
      disconnect disposes the subscription, unknown key stays attached.
- [x] `pnpm build` and `pnpm test` green.
