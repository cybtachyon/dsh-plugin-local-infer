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
