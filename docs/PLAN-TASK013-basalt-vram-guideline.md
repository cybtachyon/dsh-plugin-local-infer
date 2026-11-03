# TASK 013 — Add Basalt VRAM / preset / guideline data

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 009

## What

- `packages/providers/src/vram.ts`: add a Basalt `VramModel` for the
  `Qwen3.8-Flash-Next` NVFP4 artifact, flagged `source: 'estimated'` (the
  measured figures are not yet available; the weights/KV terms are estimated
  from the model size, not measured against the engine).
- `packages/providers/src/guidelines.ts`: add a `basalt-needs-blackwell`
  guideline (level `error`) that fires when the detected GPU is not sm_120.
- `packages/providers/src/presets.ts` (optional): a Basalt built-in preset for a
  Blackwell card if a sane starting config is warranted.

## Definition of Done

- `pnpm build` type-checks.
- A unit test asserts the Basalt `VramModel` is registered with
  `source: 'estimated'` and that the `basalt-needs-blackwell` guideline fires for
  a non-Blackwell hardware profile and not for sm_120.
