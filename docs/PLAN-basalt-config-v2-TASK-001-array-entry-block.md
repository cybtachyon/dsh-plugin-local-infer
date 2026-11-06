# TASK-001: Array-entry block convention for configFileFromSpecs

## Goal

Give the shared config-file renderer the nesting the Basalt config v2 shape
needs without a Basalt-specific renderer: a `config` deploy target whose
`block` ends in `[]` (e.g. `models[]`) collects its keys into the single object
of a one-element array named by the prefix (`{"models": [{...}]}`). Multiple
specs sharing one `name[]` block merge into that one entry object.

## Touch points

- `packages/core/src/parameter.ts`: document the convention on the
  `ParameterDeploy` `config` variant's `block` field (the type stays
  `block?: string`; no type change).
- `packages/providers/src/adapters.ts` `configFileFromSpecs`: implement the
  convention. A block ending in `[]` nests under the prefix as an array whose
  sole element is the merged object; plain blocks keep today's behavior.
- `packages/providers/tests/adapters.spec.ts`: add cases
  - two specs with `block: 'models[]'` merge into `{"models": [{key1, key2}]}`;
  - an `[]` block and a plain block coexist (`{"models": [...], "server": {...}}`);
  - the `toConfig` spelling and default fallback still apply inside entries;
  - existing cases stay green (a plain block never gains array behavior).
- Rebuild the tracked `lib/` outputs (`pnpm build`).

## Definition of Done

- `pnpm vitest run packages/providers/tests/adapters.spec.ts` (via `pnpm test`)
  is green, old and new cases alike.
- `tsc -b` clean and the touched `lib/` artifacts are committed with the src.
- Committed as one commit referencing the convention.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
