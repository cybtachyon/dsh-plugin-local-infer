# TASK-002: Orchestrator config persistence and prompt.md default

In `packages/orchestrator/src`:

- A stored-config module with `orchestratorConfigPath()`, `readOrchestratorConfig()`,
  and `writeOrchestratorConfig(config)` persisting `{ prompt: string }`.
  Persistence location (decided): `~/.dsh/local-infer/orchestrator.json`,
  created on first write; a missing or broken file reads as "no saved
  prompt". Mirror the sanitize-on-read discipline of
  `packages/ui/src/config.ts`.
- `defaultOrchestratorPrompt()` reading `prompt.md` from the package root via
  `new URL('../prompt.md', import.meta.url)` (source runs resolve through the
  `../src` mapping and tests through the same relative hop; verify both the
  `src/` and `lib/` depths work, adjusting the URL so the file resolves from
  the emitted `lib/index.js` as well). Cache the file read; an unreadable file
  yields `''` without throwing.
- An in-memory holder for the effective prompt: saved value when present,
  otherwise the default; exposed as a getter plus a setter that persists and
  refreshes the holder (single source of truth for TASK-003/004).

Add `packages/orchestrator/tests/orchestrator-config.spec.ts` covering:
missing file default, round-trip save/read, broken file fallback, default
resolution from both source and emitted depth.

Definition of Done: the spec passes under `pnpm test`; typecheck clean; one
commit.

## Answered open questions

- Persistence: dedicated `~/.dsh/local-infer/orchestrator.json`.
