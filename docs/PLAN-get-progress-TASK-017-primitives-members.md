# TASK-017: add `Tag` / `Pill` / `TextShimmer` to `PrimitivesModule`

## Context

`PrimitivesModule` in `packages/client/src/render/primitives.tsx` is the
guarded surface the card draws from. It currently declares `Menu`, `Button`,
`Checkbox`, `StateDot`, `IconChevronDownOutlineRegular`, and
`IconRefreshOutlineRegular`. The step chips (TASK-014) and the cancel
affordance (TASK-016) need `Tag`, `Pill`, and `TextShimmer` from the
primitives seed (`@deepseek-ai/dsh-client-ui-primitives` 0.2.1-alpha.3
exports all three; it exports no `Progress`). A missing seed is a fallback,
not an error, so every renderer draws its native control when the member is
absent.

## Change

- `packages/client/src/render/primitives.tsx`:
  - Add `Tag?: unknown`, `Pill?: unknown`, and `TextShimmer?: unknown` to
    `PrimitivesModule`.
  - Add guarded renderers with native fallbacks:
    - `renderTag(text: string, tone?: 'success' | 'info' | 'quiet' | 'danger'): ReactNode`
      : the DSH `Tag` atom when seeded, a native styled span otherwise.
    - `renderPill(text: string, onClick?: () => void): ReactNode`
      : the DSH `Pill` atom when seeded, a native compact button/span
      otherwise.
    - `renderTextShimmer(children: ReactNode): ReactNode`
      : the DSH `TextShimmer` wrapper when seeded, a native CSS shimmer
      (a keyframed opacity/gradient animation) otherwise.
  - Guard each use (`primitives && typeof primitives.X === 'function'`).
- The bootstrap (`mountCard` in `packages/client/src/plugin.ts` or wherever
  `setPrimitivesModule` is called) already passes the whole seed module, so
  the new members are picked up automatically; verify no change is needed
  there.

## Definition of Done

- The three members are declared and the three renderers guard on
  function-ness with working native fallbacks (a test asserts the fallback
  renders when the seed is null and the primitive renders when a function is
  seeded).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/render/primitives.tsx`
- the client primitives tests (under `packages/client/tests/`).
