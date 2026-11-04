# TASK-018: add `--format human` to the Infernix extra-download commands

## Context

Discovered during TASK-001: `infernixGetDownloads` in
`packages/providers/src/engines/infernix/infernix.ts` renders its own
`hf download` strings for the DFlash2 drafter and the PLE n-gram volume
(bypassing the core `hfDownloadCommand` builder), so those Get-run
downloads (run through `request.host.runStream` in
`runModelDownloadStep`, `packages/ui/src/ops/get-steps.ts`) will not print
tqdm progress under the new streaming work.

## Change

- `packages/providers/src/engines/infernix/infernix.ts`
  (`infernixGetDownloads`): append `--format human` to every rendered
  command (both the hub-cache and `--local-dir` forms of the drafter and
  volume downloads), matching the core builders' contract. Update the doc
  comment to note the flag.

## Definition of Done

- Every command `infernixGetDownloads` renders carries `--format human`.
- Existing provider tests that assert these strings are updated and pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green (build before test: the
  cross-package tests run against the compiled `lib/` output).

## Files

- `packages/providers/src/engines/infernix/infernix.ts`
- the provider tests that assert the rendered Infernix download strings
  (under `packages/providers/tests/`).
