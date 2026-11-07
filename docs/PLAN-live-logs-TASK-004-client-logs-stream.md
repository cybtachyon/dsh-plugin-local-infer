# TASK-004: Client run-log stream attached to in-flight provider processes

Dependencies: TASK-003. Questionnaire Q2: streaming NDJSON, no client
polling. Questionnaire Q3: the Logs pane follows the edited provider, else
the latest started run.

Make the card read the run-log stream while a stateful provider process
runs, so the Logs textarea updates the moment the host appends a line.

- `packages/client/src/api/routes.ts`: add
  `subscribeRunLogs(key: string, onEvent: (e: RunLogsEvent) => void, signal?: AbortSignal): Promise<void>`
  over `GET /local-infer/logs?provider=<key>`, reusing
  `readNdjsonLines`; a stream break on an active run reconnects once with
  backoff (the snapshot catch-up covers the gap); a break after settle ends
  quietly.
- New store module `packages/client/src/store/logs-stream.ts`:
  - `attachRunLogStream(store, key)` returns a handle with `detach()`; it
    feeds the live buffer: `snapshot` replaces the buffer, `runBegin`
    replaces it with the seed, `log` appends via the existing
    `appendLogChunk`-style dispatch, `runEnd` clears the in-flight marker
    for that key.
  - One attached stream at a time for the pane target (Q3): when the edited
    provider changes or another run starts, detach the old key and attach
    the new one.
  - Attach when a driver starts a process (see wiring) and the Logs section
    is mounted; detach on settle, cancel, unmount, or pane-target switch.
    A page refresh mid-run: on mount (and on `editingProviderId` change),
    if the summary shows that provider's process running, attach for the
    snapshot catch-up.
- Wire the attach into the drivers in
  `packages/client/src/store/providers.ts`, `deps.ts`, and the download
  driver in `packages/client/src/store/actions.ts`:
  `performEntryLaunch`, `performDraftLaunch`, `performEntryStop`,
  `performGet`, `performInstall`, and the model/template download, using
  the same key rule the host applies (provider id, else engine id; the
  client knows its own provider id).
- The run-log stream keeps the per-provider capability the route has; only
  the pane's target key is attached (Q3).

Definition of Done:

- [ ] `logs-stream.ts` with unit tests (fetch stub streaming NDJSON):
      snapshot replace, runBegin replace, log append, runEnd, detach on
      unmount/cancel/switch, single-attach invariant, reconnect-once.
- [ ] Every driver above attaches and detaches exactly one stream per run;
      tests cover the entry-launch and get paths.
- [ ] `pnpm build` and `pnpm test` green.
