# TASK-004: basalt plan model-id stamp

Stamps `plan.modelId` so the service's launched-models tie, the persisted
launch record, and the adopted re-link all name the model the engine serves.

Files: `packages/providers/src/engines/basalt/basalt.ts`,
`packages/providers/src/model-defaults.ts`,
`packages/providers/src/engines/basalt/basaltAdapter.ts`,
`packages/providers/tests/basalt.spec.ts`,
`packages/providers/tests/model-defaults.spec.ts` (only if the constant swap
changes anything observable).

Changes:

- `basalt.ts`: add `export const BASALT_DEFAULT_MODEL_ID = 'qwen38-flash-next'`
  (the single default registry entry's model id).
- `model-defaults.ts`: the basalt DEFAULT_MODELS entry uses the constant
  instead of the literal (one source of truth).
- `basaltAdapter.renderLaunch`: stamp `modelId: modelValue !== '' ?
  modelValue : BASALT_DEFAULT_MODEL_ID` (the raw config.model string, so the
  status tie compares equal against the provider's stored config.model, the
  infernix pattern; a bare config names the engine's single default model).
- Test: a config with model 'qwen38-flash-next' stamps that value; a config
  naming a '.basalt' file stamps it; a bare config stamps
  BASALT_DEFAULT_MODEL_ID.

Definition of done: `pnpm vitest run packages/providers/tests/basalt.spec.ts
packages/providers/tests/model-defaults.spec.ts` passes; `pnpm build` lands
the tracked lib outputs; commit.

Depends on: none.
