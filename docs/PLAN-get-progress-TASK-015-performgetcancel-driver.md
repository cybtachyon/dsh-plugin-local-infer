# TASK-015: `performGetCancel` driver

## Context

The existing provider-form Cancel (`cancelProvider` in
`packages/client/src/store/providers.ts`) is the primary cancel path: it
calls `cancelInFlightRuns(providerId)` (from `store/abort.ts`, landed in the
desync work), appends the `--- Canceled` line, and collapses the form. The
request wants a lighter `performGetCancel` driver that cancels the in-flight
Get run without collapsing the form: it writes the `--- Canceled` line,
clears `getProgress`, and keeps the form open. It builds on
`cancelInFlightRuns()`.

## Change

- New driver (in `packages/client/src/store/deps.ts` beside `performGet`, or
  a small `packages/client/src/store/get.ts`): `performGetCancel(store: CardStore): void`
  :
  - Calls `cancelInFlightRuns()` (no provider id, so it aborts the in-flight
    Get runs) and, when a run was aborted, appends the `--- Canceled` line to
    the Logs buffer (reuse the existing `appendCanceledLog` path or its
    equivalent).
  - Clears `ui.getProgress` back to `null` (a `ui/patch`).
  - Does NOT collapse the provider form or discard the draft (the form stays
    open, unlike `cancelProvider`).
- Keep `cancelProvider` as the primary path (unchanged).

## Definition of Done

- A test: with an in-flight Get, `performGetCancel` aborts it (the
  `--- Canceled` line lands in the Logs buffer), clears `getProgress` to
  `null`, and leaves `providerFormMode` / `editingProviderId` / the draft
  untouched.
- `cancelProvider` behavior is unchanged (existing tests pass).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/store/deps.ts` (or a new `store/get.ts`)
- `packages/client/src/store/abort.ts` (reuse `cancelInFlightRuns`)
- the client store tests (under `packages/client/tests/`).
