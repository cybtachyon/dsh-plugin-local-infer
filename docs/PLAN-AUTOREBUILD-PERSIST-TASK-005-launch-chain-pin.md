# TASK-005 - Pin the launch chain: autoRebuild false skips Get/Rebuild, launches with expected parameters

Lock in the end-to-end skip behavior of a card Launch whose request carries
`autoRebuild: false`.

- Files: `packages/ui/tests/launch.spec.ts` (and `packages/ui/src/ops/engine.ts`
  if a real gap shows up; the request -> GetStepsRequest -> deploy threading
  already exists).
- Assert the chain: the Get-steps run reports the
  `engine sync and build: auto rebuild off, skipped` line and runs no git/build
  host command; `localInfer.launch` receives `autoRebuild: false`; the model and
  chat-template download steps still run when the artifact is absent (Q3).
- Assert that a request with no `autoRebuild` key keeps the full run (CLI
  legacy), and `autoRebuild: true` runs the sync/build steps.
- DoD: the new spec cases pass; no production change needed, or the discovered
  gap is fixed in the same commit. Commit with any emitted `lib/` output.
