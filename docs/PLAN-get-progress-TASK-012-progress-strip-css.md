# TASK-012: custom thin CSS progress strip on `--dsw` tokens

## Context

The primitives package (`@deepseek-ai/dsh-client-ui-primitives`
0.2.1-alpha.3) exports no `Progress` component, so the title-bar progress
bar is a custom thin CSS strip on the `--dsw` design tokens with a native
fallback. The `'getting'` control spec (TASK-010) carries the
`GetProgressState` the strip renders from.

## Change

- `packages/client/src/styles.ts` (or a new render module): add a thin
  progress-strip style using `--dsw` tokens (track + fill), e.g. a 3-4 px
  tall rounded strip whose fill width is the percent.
- `packages/client/src/render/primitives.tsx` (or the title-bar render
  component that consumes the `'getting'` control): add a
  `renderProgressStrip(progress: GetProgressState | null): ReactNode` that
  draws the strip from the percent, with a native (plain div) fallback that
  works with or without the primitives seed. Guard any primitive use
  (`primitives && typeof primitives.X === 'function'`).
- Wire the strip into the `'getting'` title-bar control render (the
  component that draws `deriveLifecycleControl`'s spec), so the readout and
  the strip appear together.

## Definition of Done

- The strip renders a fill proportional to the percent (a test asserts the
  width style tracks `percent`), degrades to a native div when the seed is
  absent, and renders nothing (or a 0% track) when `getProgress` is null.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/styles.ts`
- `packages/client/src/render/primitives.tsx` (or the title-bar render
  component)
- the client render tests (under `packages/client/tests/`).
