# TASK-009: Step events reported for the real phases in real order

Dependencies: TASK-008, Questionnaire Q4 answer.

Fix the mismatch the user reported: the button reads "Prereqs..." while the
hf CLI downloads a model.

Host side (`packages/ui/src/ops/engine.ts`, `ops/get-steps.ts`):

- Today `launchEngine` announces `prereqs` once at start (when the trust
  gate is on) and nothing until the adapter's deploy. `runGetSteps` gains a
  step reporter so each of its steps announces its phase as it starts:
  - `runDepsStep` announces only when an install actually runs (the gate
    on); a satisfied-deps check is not a prereqs phase.
  - `runSyncBuildStep` announces `build` when the clone/build actually runs
    (autoRebuild on).
  - `runModelDownloadStep` (and the Infernix extras) announce `download`
    when a download actually runs; `runChatTemplateStep` announces
    `download` too.
- Standalone Get requests pass no reporter (the Get control keeps its
  throbber), the same way `onProgress` is already optional.

Client machine (`packages/client/src/machine/launch.ts`) per the Q4 answer
(recommended option a):

- A `step` event from the live run stream is authoritative for the current
  run: set the reported state directly (keeping the existing guards: stop
  in flight supersedes a late step; unknown step names stay no-ops; the
  `downloading` re-poll state ignores steps as today).
- Drop or restate the `LAUNCH_STEP_ORDER` forward-only rule accordingly;
  update the module doc comment that describes the order.

Definition of Done:

- [ ] `packages/service` / `packages/ui` tests: a launch that runs the model
      download step emits prereqs? -> build? -> download -> launch step
      events in real order for a stubbed Get-steps sequence.
- [ ] `packages/client/tests/launch.spec.ts`: step events set states in the
      real order (build then download), stop supersede, unknown names no-op.
- [ ] `pnpm build` and `pnpm test` green.
