# TASK-002: Model directory resolves to the hf download result

In `packages/ui/src/ops/model.ts`, `resolveModelDirectory` currently returns
the config override or `localInfer.defaultModelDirectory()` (the hub cache
root). Change the no-override branch to the Hugging Face CLI download path
result: when the run names a selected model whose default entry resolves
(`defaultModelFor`), return
`hfDownloadResultDirectory(hfHubCacheDirectory(), repoIdFromUrl(entry.url), entry.file ?? '')`
when it resolves; otherwise fall back to the hub cache root (the base the hf
CLI downloads into). Thread the selected model entry through the signature
(callers: `packages/ui/src/ops/get-steps.ts` `runGetSteps` — pass
`request.config.model` resolved through `defaultModelFor(request.engineId,
modelId)`; keep the signature additive so other callers compile).

The hub-cache download layout itself (`useHubCache`, no `--local-dir`) stays
unchanged in this task; only the resolved *directory* the steps and plans
name for the model changes.

Update `packages/ui/tests/route.spec.ts` expectations that name the model
directory for the default (no override) case (e.g. the Get-steps model
download assertions around the "hub-cache layout" tests near
`renders the hub-cache layout`), and add a test: with no modelDirectory
override and a basalt/ninfer artifact present in a fake hub cache, the
resolved model directory is the snapshot directory, not the hub root.

Definition of Done: `resolveModelDirectory` returns the snapshot directory
for a cached artifact and the hub root otherwise; existing suites pass;
new test passes; ui `lib/` outputs committed; prek clean; committed.

Depends on: TASK-001.
