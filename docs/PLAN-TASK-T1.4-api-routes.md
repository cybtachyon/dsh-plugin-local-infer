# T1.4 `src/api/routes.ts`.

Typed fetch wrappers for
`/local-infer/summary`, `deps`, `save`, `install`, `register`,
`unregister`, `launch` (NDJSON), `stop`, `get` (NDJSON), `download`,
`chat-template`. Request/response types come from
`dsh-plugin-local-infer/ui` (`import type` only) plus local request
types. Include the NDJSON line reader (chunk buffering, partial final
line, skip unparseable lines, keep the `result` event).

**DoD:** unit tests with a stubbed global `fetch` cover: non-OK
responses throw with `body.error`; NDJSON split across chunk
boundaries; a partial line completes on the next chunk; a malformed
line is skipped; the final `result` event is returned;
`pnpm build` green.
