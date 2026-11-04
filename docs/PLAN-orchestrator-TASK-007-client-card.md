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
  route exists; the main card's existing probe is unchanged.
- Locale/title strings follow the existing `Card.tsx` locale seam.

Tests: extend the client specs (`packages/client/tests/`): route-exists
gating (no registration on 404/network failure, registration on 200/other),
render of the title and field label, save posts the edited prompt.

Definition of Done: `pnpm test` passes; no change to the main card's mount
behavior; one commit (sources only; the rebuilt artifact is TASK-008).

## Answered open questions

- Slot scope: `plugins.bundle.config` only (decided); no
  `settings.plugin.item` registration for this card.
