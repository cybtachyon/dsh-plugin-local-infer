# TASK-021: route the Infernix extra-download chunks to the progress sink

## Context

Discovered during TASK-003: in `runModelDownloadStep`
(`packages/ui/src/ops/get-steps.ts`), the Infernix DFlash2 drafter and PLE
n-gram volume downloads run through
`request.host.runStream(command, (chunk) => emit(chunk), …)`, so their tqdm
lines reach only the log sink (`emit`), not the `onChunk` progress sink.
TASK-004's `{ progress }` events (which parse the `onChunk` stream) will
therefore not cover the Infernix extra-download progress, even though those
downloads carry `--format human` (TASK-018).

## Change

- `packages/ui/src/ops/get-steps.ts` (`runModelDownloadStep`): when the
  Infernix extra downloads run through `request.host.runStream`, hand each
  chunk to both the log sink and the progress sink
  (`(chunk) => { emit(chunk); onChunk?.(chunk) }`), so their tqdm lines feed
  the same `{ progress }` events the model and template downloads do. When
  `onChunk` is absent (a caller that does not stream progress), the chunk
  still lands in the log sink only.

## Definition of Done

- A test asserts: with an injected `onChunk`, the Infernix extra-download
  chunks (a stubbed `host.runStream` that invokes its chunk callback with a
  fake tqdm line) reach both the log sink and the `onChunk` sink.
- The existing Infernix Get-route tests (the drafter + n-gram volume lines in
  the log) still pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test).

## Files

- `packages/ui/src/ops/get-steps.ts`
- the ui route/ops tests that exercise the Infernix Get path (under
  `packages/ui/tests/`).
