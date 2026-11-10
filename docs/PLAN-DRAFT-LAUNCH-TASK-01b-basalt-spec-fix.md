# TASK-01b - Sync basalt.spec.ts with the vram-reserve-mib param

File: `packages/providers/tests/basalt.spec.ts` (expectations only; the
engine/parameter source is intentional from 561b01c, do not change it).

- 4 tests fail at HEAD: the parameter surface-order list and the rendered
  engine-block objects predate the `vram-reserve-mib` param (the rendered
  engine block now carries `"vram-reserve-mib": 700` in the parameter
  default order). Update the expectations to the current intentional
  surface (check where the param declares its order/default in
  `packages/providers/src/` first; the test follows the source, not the
  reverse).
- If the expected value order/default in the source reads accidental (for
  example the param appears twice or outside the declared group), stop and
  report instead of blessing it in the test.

Definition of Done:
- `npx vitest run packages/providers/tests/basalt.spec.ts` green (47/47).
- Full `pnpm test` green.
- No src changes unless the investigation above finds a real bug (then report
  it to the parent as a pre-existing issue and commit only the test fix).
