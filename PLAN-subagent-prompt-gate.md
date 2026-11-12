# PLAN-subagent-prompt-gate

Objective: update `packages/orchestrator` so the Orchestrator prompt section is
injected into the system prompt only for primary (top-level) agents, not for
sub-agents. All seams, storage, routes, and the settings card stay unchanged.

## Verification guidelines

- The seam spec in `packages/orchestrator/tests/orchestrator-seam.spec.ts`
  proves the gate: a root-agent assembly gets the prompt, a non-root assembly
  gets `''`, and a profile without the agent registry keeps today's behavior.
- `pnpm build` emits and `verify-emit` checks `packages/orchestrator/lib`; the
  tracked `lib/` outputs are committed with the `src/` change.
- Full gate: `pnpm test`, `pnpm lint`, `prek run --files <paths>` before the
  commit (see AGENTS.md for the canonical commands; not repeated here).

## Design spec (single source of truth)

- Discriminator: the live agent registry. dsh-agent provides the service named
  `agents` (`AgentRegistry`, `super(ctx, "agents")`). A prompt assembly runs
  with `AssembleContext { agent, scope: agent }` (`assembleContextFor`), and
  the agent object itself is the scope key. `ctx.agents.roots()` returns the
  live top-level agents (created without an owning agent context); first-party
  precedent: `ctx.agents.roots().includes(execution.agent)` in dsh-tool-goal.
- New local narrowing interface in `src/index.ts` (no new package dependency,
  same pattern as `SystemPromptService` and `WebServerService`):

  ```ts
  export interface AgentRegistryService {
    /** All live top-level (primary) agents, in registration order. */
    roots(): readonly object[]
  }
  ```

- `apply()` pulls a third optional seam with the existing `mountSeam` helper,
  declared BEFORE the `systemPrompt` seam, skipped log name
  `'agent registry skipped'`, capturing the registry into a local holder.
- The section's `text` becomes a per-assembly gate:

  ```ts
  text: (assembly) =>
    isPrimaryAssembly(agents, assembly?.scope) ? getOrchestratorPrompt() : '',
  ```

  where `isPrimaryAssembly(agents, scope)` is true when the registry seam
  never arrived (no agent runtime: nothing to exclude), when `scope` is
  `undefined` (a global unscoped assembly), or when
  `agents.roots().includes(scope)`. An empty section text is dropped by
  `renderPrompt`, so sub-agents get no Orchestrator text.
- `SystemPromptService.section` local type widens the `text` provider to
  `(context?: { scope?: object }) => string` (parameter optional so existing
  zero-arg test calls stay sound).
- Section `name`, `order` (100), and `interpolate: false` stay unchanged.
- Module doc comment in `src/index.ts` states the primary-agent-only rule.

## Open questions (answered 2026-11-11)

- [x] Q1 Discriminator: **Live agent registry roots().** `ctx.agents.roots()`
  lists live top-level agents (created without an owning parent), matching the
  dsh-tool-goal precedent.
- [x] Q2 Fallback for unclassifiable assemblies (agents service absent, or
  unscoped assembly): **Keep injecting.** These are not sub-agent assemblies;
  suppression applies only to a definitively non-root agent scope.

## Micro-tasks

### Phase 1: Implementation

- [x] TASK-01 Gate the section text provider in `packages/orchestrator/src/index.ts`
  per the design spec (agents seam, `AgentRegistryService`,
  `isPrimaryAssembly`, doc comments).
  DoD: `pnpm build` type-checks and emits `lib/`; `apply()` still no-ops
  without `inject`; existing section fields unchanged.
- [ ] TASK-02 Extend `packages/orchestrator/tests/orchestrator-seam.spec.ts`:
  update the inject-request expectation to `[['agents'], ['systemPrompt'],
  ['webServer']]`; add a fake agents seam (`{ agents: { roots: () => [root] } }`);
  add cases: root scope gets the prompt, non-root scope gets `''`, registry
  absent keeps the prompt for any scope, unscoped assembly gets the prompt,
  gate re-reads `roots()` per assembly.
  DoD: `npx vitest run packages/orchestrator` green.

### Phase 2: Quality

- [ ] TASK-03 Refactor: review the files touched by the previous 2 tasks and
  resolve the code-risk checklist (see the Refactor instruction block in this
  file below). DoD: no checklist item left unresolved; tests still green.

  ```text
  Review the files touched by the previous 2 commits and identify the following code risks:
   - **Multiple Sources of Truth**: Same calculations done in multiple places.
   - **Duplicate Code**: Nearly-identical code in multiple methods.
   - **Bloaters**: Too many things done in a single method or class.
   - **Data Clumps**: Single variables that travel in a group for multiple methods.
   - **Shotgun Edits**: Commits with singular changes that touch multiple files.
   - **Feature Envy**: Method where over 50% of the code manipulates a different class.
   - **Magic Numbers**: Literals without context in method bodies.
   - **Overengineering**: Methods with single lines of code or slim classes.
  Then address and resolve each risk.
  ```

### Phase 3: Docs + verification + commit

- [ ] TASK-04 Update the "It injects while enabled" bullet in `README.md` and
  the matching bullet in `docs/zh/README.md` to say the prompt reaches the
  primary agent's system prompt and sub-agents do not receive it. Run
  `pnpm build`, `pnpm test`, `pnpm lint`, `prek run --files <changed paths>`;
  commit `src/` + emitted `lib/` + tests + docs.
  DoD: all gates green; one commit with the functional change; working tree
  clean.

## Task dependencies

- TASK-02 depends on TASK-01.
- TASK-03 depends on TASK-02.
- TASK-04 depends on TASK-03.
