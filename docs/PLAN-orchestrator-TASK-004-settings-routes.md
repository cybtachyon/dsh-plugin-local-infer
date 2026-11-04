# TASK-004: Orchestrator settings routes

Register two webServer routes from the orchestrator plugin through a scoped
`ctx.inject(['webServer'], ...)`, mirroring the ui package's route plumbing
(`packages/ui/src/route.ts`): reuse or locally mirror the minimal
`defineRoute`-style template (method guard 405, bounded body 413, JSON answer)
rather than importing ui internals across package boundaries unless that
import is already workspace-legal (relative `../../ui/lib/index.js` style is;
prefer a small local copy of the template if the ui package does not export
it).

- `GET /local-infer/orchestrator` → `{ prompt, defaultPrompt, saved }`: the
  effective prompt, the shipped default from `prompt.md`, and whether the
  effective prompt is a saved value.
- `POST /local-infer/orchestrator/save` → body `{ prompt: string }`; a string
  persists through the TASK-002 setter (empty string clears the saved override
  back to the default); answers with the GET payload shape.

Route names: `local-infer-orchestrator`, `local-infer-orchestrator-save`.

Tests: use the fake req/res harness from `packages/ui/tests` (adapt or import)
covering method guard, save→get round trip, blank-prompt clearing, and the
404-free probe semantics the client relies on (any non-404 answer).

Definition of Done: routes register when a `webServer` seam is present and are
skipped silently when absent; specs pass; one commit.

## Answered open questions

(none specific to this task)
