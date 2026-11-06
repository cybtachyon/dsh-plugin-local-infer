# TASK-002: Re-block the Basalt parameter surface for config v2

## Goal

Move each `BASALT_PARAMETERS` spec's `config` deploy target to its v2 block:

| spec key | deploy target after the move |
| --- | --- |
| port, host | `{ target: 'config', format: 'json', block: 'server' }` (unchanged) |
| gpu, parallel, vision, model | `block: 'models[]'` |
| maxContext | `block: 'models[]'`, `key: 'max-context'` |
| kv | `block: 'engine'` (unchanged block; see the note below) |
| expertCache, prefill, residentExperts, spec | `block: 'engine'` (unchanged) |

`kv` stays in the top-level `engine` block on purpose: a flag the model lacks
stops the start in a model entry but is left out for that model in `engine`
(upstream `docs/configuration/models.md`), so one surface serves both
Flash-Next (takes `kv`) and DeepSeek-V4.1-Flash (has no KV choice). Document
that reason in the spec's comment.

Add `export const BASALT_CONFIG_VERSION = 2` to
`packages/providers/src/engines/basalt/basalt.ts` (the file's own format
version stamp, consumed by TASK-003's envelope).

Refresh the doc comments: the module header and the `BASALT_PARAMETERS` header
currently say every value nests under `server` or `engine`; say the v2 truth
instead: shared server options under `server`, per-model settings under the
`models[]` entry, shared engine flags under `engine`.

## Touch points

- `packages/providers/src/engines/basalt/basalt.ts`
- `packages/providers/tests/basalt.spec.ts`: the `Basalt parameter surface`
  describe - the per-spec deploy-target expectations and the two
  `configFileFromSpecs(BASALT_PARAMETERS, ...)` render cases now expect
  `{server, models: [{...}], engine}`.
- Rebuild `lib/` (`pnpm build`).

## Definition of Done

- The surface keys stay in the same form order (the order test stays green).
- `pnpm test packages/providers/tests/basalt.spec.ts`-scoped specs are green.
- Committed with the `lib/` outputs.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
