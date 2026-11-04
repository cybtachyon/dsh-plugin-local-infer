# TASK-007: Orchestrator browser card

In `packages/client/src`:

- API wrappers in `api/routes.ts`: `orchestratorRouteExists()` (probe
  `GET /local-infer/orchestrator`, non-404 proves presence — same rule as
  `routeExists`), `fetchOrchestrator()` (GET), and `postOrchestratorSave({
  prompt })` (POST), reusing the existing getJson/postJson helpers and types.
- A second card component (new module, e.g. `OrchestratorCard.tsx`, drawing on
  the `Card.tsx`/`render/` patterns and the guarded primitives seam):
  - Title "Orchestrator".
  - One settings field labelled "Orchestrator Prompt": a textarea prefilled
    with the GET answer's `prompt` (the `prompt.md` default when nothing is
    saved); show the shipped `defaultPrompt` as placeholder or hint text.
  - A Save control calling the save route and confirming success/error,
    disabled while a save is in flight.
- Mounting in `plugin.ts`: probe `orchestratorRouteExists()` inside the same
  `slots` scoped inject; register into `plugins.bundle.config` keyed to
  `PACKAGE_NAME` like the main card, with an `id`/`order` that keeps the two
  cards independent (verify the keyed slot renders both registrations; check
  the live slot topology through the client Slots inspect provider or the
  plugin-manager page's slot spec, and choose spec fields so the Engine
  settings card is unaffected). Mount the orchestrator card only when its
  route exists; the main card's existing probe is unchanged. (Superseded at
  implementation: the keyed cell cannot render two cards; see "Discovered
  constraint" below.)
- Locale/title strings follow the existing `Card.tsx` locale seam.

Tests: extend the client specs (`packages/client/tests/`): route-exists
gating (no registration on 404/network failure, registration on 200/other),
render of the title and field label, save posts the edited prompt.

Definition of Done: `pnpm test` passes; no change to the main card's mount
behavior; one commit (sources only; the rebuilt artifact is TASK-008).

## Answered open questions

- Slot scope: `plugins.bundle.config` only (decided); no
  `settings.plugin.item` registration for this card.

## Discovered constraint (2026-11-04, implemented deviation)

The decided mount is infeasible on the current host, and the task's own
verification step surfaced why. Verified against the installed host
(0.2.1-alpha.3 bundles, `@deepseek-ai/dsh-client-ui-slots` +
`@deepseek-ai/dsh-client-ui-renderer` + the plugin-manager page):

- `plugins.bundle.config` is a `kind: 'keyed'` slot. The renderer dispatches
  it as `entriesOfSlot('plugins.bundle.config').find((e) => e.options.key ===
  entryKey)` with `entryKey` the bundle's package name, and `entriesOfSlot`
  projects one shadowing winner per cell. Two registrations keyed
  `dsh-plugin-local-infer` therefore cannot coexist-render: at the same
  default priority the second `register` throws (SlotCore's fail-loud
  one-occupant-per-cell rule), and at a distinct priority the loser never
  renders. No `id`/`order` fields exist for keyed entries.
- The host's designed home for one component row's configuration is
  `plugins.row.config`, keyed `<package name>#<row id>`. The Plugins page
  gives the `local-infer-orchestrator` row a Configure control exactly while
  that key is registered (its ledger reads `keysOf('plugins.row.config')`),
  and renders the entry as the row page's body (`view: 'page'`). The row's
  title and description come from the component's shipped
  `packages/orchestrator/locale/en.json` meta (added in TASK-001).

Implemented: the orchestrator card registers into `plugins.row.config` under
`dsh-plugin-local-infer#local-infer-orchestrator`, still probed
independently through `orchestratorRouteExists()` in the same `slots`
scoped inject. The Engine settings card is unaffected (it stays the sole
occupant of the bundle-config cell), and the decided "no
`settings.plugin.item` registration" holds. TASK-012's walkthrough should
confirm the live slot topology and the row's Configure control.
