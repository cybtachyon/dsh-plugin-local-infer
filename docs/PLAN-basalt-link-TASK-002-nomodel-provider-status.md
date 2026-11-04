# TASK-002: no-model provider status rule

Makes a provider that names no model confirm against the plugin-launched
engine tied to its port, instead of reading unsure forever.

Files: `packages/core/src/status.ts`, `packages/core/tests/status.spec.ts`.

Context: `RunningEngineRef.modelId` is only ever stamped by the service from
its launched-models map (this plugin launched that port with that model, or
adopted the process from its own record). A no-model provider with a
plugin-launched, model-tied engine on its exact port is that provider's own
engine; an unattributed (foreign) engine carries no modelId and must keep
reading unsure.

Changes:

- `computeProviderStatuses`: a provider reads running when `identified`
  exists and either the provider names no model
  (`provider.model === undefined`) or `identified.modelId === provider.model`.
- Update the contract doc comment (rule 1) to state the no-model case.
- Tests: replace the existing
  "reads a provider that names no model as unsure while its engine runs
  without a model" case with two: no-model provider + model-tied ref on the
  provider's port reads running; no-model provider + untied ref reads unsure.

Definition of done: `pnpm vitest run packages/core/tests/status.spec.ts`
passes; `pnpm build` lands the tracked `packages/core/lib` outputs; commit.

Depends on: none.
