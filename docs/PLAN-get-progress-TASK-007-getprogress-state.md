# TASK-007: `CardUiState.getProgress` field riding `ui/patch`

## Context

`CardUiState` in `packages/client/src/store/types.ts` is the UI-local state
the card keeps and never syncs. The `ui/patch` action
(`{ type: 'ui/patch'; patch: Partial<CardUiState> }`) is the existing path
for updating it, and `initialCardState()` builds the starting ui state.

## Change

- `packages/client/src/store/types.ts`: add
  `getProgress: GetProgressState | null` to `CardUiState` (import the type
  from `./progress.ts`), and set it to `null` in `initialCardState()`.
- Confirm the reducer's `ui/patch` handling already merges a
  `Partial<CardUiState>` (it does, via the existing patch merge); no
  reducer change is expected, but verify with a test.

## Definition of Done

- The type compiles; `initialCardState().ui.getProgress` is `null`.
- A `ui/patch` with `getProgress` set updates the field (reducer test).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/store/types.ts`
- the client store/reducer tests (under `packages/client/tests/`).
