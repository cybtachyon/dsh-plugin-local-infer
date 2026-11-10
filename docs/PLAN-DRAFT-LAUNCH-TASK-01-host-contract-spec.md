# TASK-01 - Host launch contract spec (no production change)

File: `packages/ui/tests/launch.spec.ts` (extend) or a new ui spec.

The questionnaire settled it: the client sends the draft's values through the
launch route's existing top-level fields (`engine`, `config`, `platform`,
`autoRebuild`), which already override the stored config per key. No host
production change. This task pins the contract the client starts to rely on
with specs:

- A launch whose request names an engine, config, platform entry, and
  autoRebuild renders the plan and runs the Get steps from those request
  values, not the stored ones (extend a case where stored and request differ).
- After a request-field launch, the stored config file carries the same
  engine, config, platform map, and provider entry fields as before; only the
  target entry's launch record and the last-run logs may differ.
- A request platform entry that names a different engineDirectory than the
  stored entry is registered with the service registry for the run (memory
  only, `stored.platform` untouched).

Definition of Done:
- New specs pass against the current code (if one fails, that IS the finding:
  report it, and it becomes a host-side fix task before proceeding).
- `pnpm build` and `pnpm test` green.
