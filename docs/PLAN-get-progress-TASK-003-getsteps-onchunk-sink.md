# TASK-003: thread `onChunk` from the get-steps emit sink into the download steps

## Context

`runGetSteps` in `packages/ui/src/ops/get-steps.ts` runs five steps in order
and streams each through a `log` sink (the get route's writer). The
`GetStepsRequest` interface carries `engineId`, `config`, `platform`,
`allowRunDeps`, `autoRebuild`, `host`, and `signal`. The model download step
(`runModelDownloadStep`) and the chat-template step
(`runChatTemplateStep`) call `localInfer.downloadModel` /
`localInfer.downloadChatTemplate` with `{ useHubCache, signal }`. The
`GetStepContext` threads an `emit: (chunk: string) => void` sink the steps
write log lines through.

The get route (`packages/ui/src/routes/get.ts`) calls `getEngine` with a
`log` callback that appends to `collected` and writes to the response
stream. `getEngine` (`packages/ui/src/ops/engine.ts`) is a thin wrapper over
`runGetSteps`. `launchEngine` (same file) also runs `runGetSteps` and
threads an `onProgress` step callback into the launch route.

Per the plan decision, the get route's stream becomes NDJSON
(`{ log }` + `{ progress }` events, TASK-004), so the raw hf stderr needs a
dedicated sink the route can parse into `{ progress }` events, separate from
the log text sink.

## Change

- `packages/ui/src/ops/get-steps.ts`:
  - Add an optional `onChunk?: (chunk: string) => void` field to
    `GetStepsRequest` (the hf download's raw stderr progress sink).
  - Thread it into `GetStepContext` and pass it as `onChunk` in the
    `downloadModel` / `downloadChatTemplate` option objects in
    `runModelDownloadStep` and `runChatTemplateStep`, so the tqdm lines
    reach the caller's sink as they land.
- `packages/ui/src/ops/engine.ts`:
  - `getEngine` accepts an optional `onChunk` and forwards it into the
    `GetStepsRequest`.
  - `launchEngine` accepts an optional `onChunk` (or a progress callback) and
    forwards it into its `runGetSteps` call, so a launch that runs the Get
    steps streams progress as well (TASK-004 wires it to the launch
    route's `{ progress }` events).

## Definition of Done

- A Get run hands the hf download's raw stderr chunks to the request's
  `onChunk` as they land (a test with a stubbed service whose
  `downloadModel` invokes the injected `onChunk` asserts the chunks arrive).
- The existing step log lines (`system dependencies`, `model download:`,
  `chat template:`, `get complete`) are unchanged.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/ui/src/ops/get-steps.ts`
- `packages/ui/src/ops/engine.ts`
- the ui ops tests that exercise the get steps (under `packages/ui/tests/`).
