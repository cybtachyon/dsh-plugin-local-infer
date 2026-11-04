# TASK-008: Rebuild the client artifact

- Run `pnpm build` (tsc -b, `scripts/build-client.mjs`,
  `scripts/build-format.mjs`).
- Inspect the regenerated `dsh/client.js`: it carries the orchestrator card
  code and still emits exactly the two runtime externals (`react`,
  `@deepseek-ai/dsh-client-ui-primitives`) and the
  `window.__ModuleLoader__.load` wrapper.
- `git status` shows only build-normalized artifacts plus `dsh/client.js`
  staging cleanly; do not stage any file unrelated to this plan (see the
  plan's verification guidelines).

Definition of Done: `dsh/client.js` regenerated and committed in one commit.

## Answered open questions

(none specific to this task)

## Carry-over notes from TASK-007 (2026-11-04)

- After the rebuild, `packages/client/tests/carrier.spec.ts` needs its
  slot-name expectations updated: the bootstrap now issues a second probe
  (`/local-infer/orchestrator`) and, when both probes answer 200, the
  recorded `slots.inject` names become `['plugins.bundle.config',
  'settings.plugin.item', 'plugins.row.config']` (the Orchestrator card
  registers into `plugins.row.config`, keyed
  `dsh-plugin-local-infer#local-infer-orchestrator`; see the TASK-007 note).
- `packages/client/lib/OrchestratorCard.*` are new tsc outputs; they land
  with this task's artifact commit.
