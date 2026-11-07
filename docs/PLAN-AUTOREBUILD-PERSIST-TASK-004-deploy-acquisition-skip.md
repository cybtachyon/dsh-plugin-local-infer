# TASK-004 - Deploy step skips image pull and binary installer when off

An unchecked Auto Rebuild must launch the already-present docker image or locally
compiled binary only; today the acquisition commands run regardless.

- Files: `packages/providers/src/engines/ninfer/ninferAdapter.ts` (docker branch
  `docker pull`), `packages/providers/src/engines/llamacpp/llamacppAdapter.ts`
  (docker branch `docker pull`), `packages/providers/src/engines/strata/strataAdapter.ts`
  (docker branch `docker pull` and the `isBinary` `STRATA_BINARY_INSTALL` run).
- Guard each acquisition command with `options?.autoRebuild !== false` (same
  guard style as the process-engine git sync). When skipped, do not announce the
  skipped phase (`onProgress?.('build')` / `('download')` rides inside the
  guard) and proceed straight to `host.spawn(plan.argv, ...)` with the plan's
  expected parameters.
- Model / chat-template downloads stay untouched (Q3: kept).
- DoD: adapter tests per engine: with `{ autoRebuild: false }` no `docker pull`
  / no install command reaches the host and the spawn still runs the plan's
  argv; with the flag absent (undefined) the pull/install still runs (CLI legacy
  behavior). Commit with the emitted `lib/` output. Existing specs live in
  `packages/providers/tests/` (adapters.spec.ts, basalt.spec.ts patterns).
