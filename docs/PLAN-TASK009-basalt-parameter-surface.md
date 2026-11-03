# TASK 009 — Add the Basalt parameter surface

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 001, TASK 004

## What

Create `packages/providers/src/engines/basalt/basalt.ts`:

- `BASALT_PARAMETERS: readonly ParameterSpec[]`, in form order, with
  `deploy: { target: 'config', format: 'json' }` and a `block` of `server` or
  `engine` per the Basalt configuration reference. Cover at least: `port`,
  `host`, `gpu`, `parallel`, `vision` (server block); `model` (server block, a
  path); `kv`, `maxContext`, `expertCache`, `prefill`, `residentExperts`, `spec`
  (engine block). Provide the enum option lists (`kv`: fp16/int8/q4_0/k8v4;
  `vision`: off/dynamic/cpu/`<gpu>`; `expertCache`: auto/`<count>`).
- A `basaltModelKey(config)` helper (the `.basalt` model path, falling back to an
  empty string).
- A `hardwareConstraint` on the surface (or a guideline, see TASK 013) that
  errors when the detected GPU is not Blackwell (`hw.gpu.sm < 120`).

## Definition of Done

- `pnpm build` type-checks.
- A unit test in `packages/providers/tests/basalt.spec.ts` asserts the spec keys
  and that each carries a `config` deploy target with the correct `block`; a
  second test asserts `configFileFromSpecs` renders a representative config into
  a `{ server: {...}, engine: {...} }` JSON object.
- The Blackwell constraint fires (returns `{ ok: false }`) for a hardware
  profile with `gpu.sm` below 120 and passes at 120.
