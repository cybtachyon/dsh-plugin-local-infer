# TASK-001: add `--format human` to the hf download command builders

## Context

`hfDownloadCommand` and `hfChatTemplateCommand` in
`packages/core/src/models.ts` render the hf CLI download strings. The hf CLI
defaults `--format` to `auto`, which picks `agent` (no progress) when stdout
is not a TTY, so a download run through `exec` prints no progress at all.
The hf CLI accepts `--format [auto|human|agent|json|quiet]`; `human` prints
tqdm progress lines to stderr.

## Change

- `hfDownloadCommand(entry, directory, useHubCache)`: append `--format human`
  to both the hub-cache and `--local-dir` forms.
- `hfChatTemplateCommand(repo, directory, useHubCache)`: append
  `--format human` to both forms.
- Update the doc comments to note the flag.

## Definition of Done

- Both builders emit `--format human` in every form (hub-cache and
  local-dir).
- Existing unit tests for the builders are updated to expect the flag and
  pass.
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/core/src/models.ts`
- the core tests that assert the rendered command strings (find them under
  `packages/core/tests/`).
