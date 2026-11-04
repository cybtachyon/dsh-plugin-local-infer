# TASK-003: Inject the prompt through the systemPrompt seam

In `packages/orchestrator/src/index.ts`:

- Reach the `systemPrompt` service through a scoped `ctx.inject(['systemPrompt'],
  ...)` so the plugin stays loadable in profiles without the dsh-system-prompt
  package (the same optional-seam pattern the client's `registerCard` and the
  ui's `webServer` narrowing use). Narrow the service with a local interface
  exposing `section({ name, order, text })` (and `context(...)` only if the
  questionnaire answer selects the dynamic-context form).
- Register one global contribution named `orchestrator` whose text is the
  effective prompt (the TASK-002 holder), evaluated per assembly via a
  provider function, so a later Save changes the next assembly without a
  restart.
- Choosing the prompt section order: a stable number between the persona
  prefix (0) and the policy/tool sections; document the pick.
- Registration lives in the plugin effect so it unregisters with the plugin.

Tests (`packages/orchestrator/tests/`): with a fake scoped context providing a
recording `systemPrompt` service, assert (a) no throw and no section when the
seam is absent, (b) exactly one contribution with the default prompt before
any save, (c) the contribution text follows the holder after a
`setOrchestratorPrompt` update.

Definition of Done: the spec passes; the package still loads into a bare
`new Context()` (bundle.spec style) with no seam present; one commit.

## Answered open questions

- Contribution: a global system-prompt SECTION
  (`ctx.systemPrompt.section`), decided in the questionnaire. The
  `context(...)` variant is out of scope.
