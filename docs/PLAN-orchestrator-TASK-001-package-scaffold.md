# TASK-001: Scaffold the orchestrator workspace package

Create `packages/orchestrator` as a workspace package mirroring the
`packages/tool` shape.

- `package.json`: name `dsh-plugin-local-infer-orchestrator`, version matching
  the workspace, `type: module`, `main`/`types` into `lib/`, `exports` for `.`
  and `./package.json`, `files: ["lib/**/*.js", "lib/**/*.d.ts", "prompt.md",
  "locale/en.json"]`, `peerDependencies: { "@deepseek-ai/cordis": ">=4.0.1" }`
  and the matching devDependency.
- `tsconfig.json` mirroring `packages/tool/tsconfig.json`.
- `src/index.ts`: cordis plugin skeleton exporting `name =
  'local-infer-orchestrator'`, `inject`, and `apply(ctx)` (a no-op body until
  TASK-003/TASK-004 fill it). Doc comment per the repo style.
- `prompt.md` at the package root with exactly:

  ```
  # Example Orchestrator Prompt
  Tell the user to configure their Orchestrator prompt.
  ```

- `locale/en.json` carrying `meta.title` "Orchestrator" and a one-line
  `meta.description` (the dsh app-boot `readPluginMeta` reads subpath
  components' display text from `<subpath>/locale/en.json`).

Wire it into the workspace:

- root `package.json`: add the `./orchestrator` export (types + default into
  `packages/orchestrator/lib`), the `./orchestrator/locale/en.json` resource
  export, and `files` rows for `packages/orchestrator/package.json`,
  `packages/orchestrator/lib/**/*.js`, `packages/orchestrator/lib/**/*.d.ts`,
  `packages/orchestrator/prompt.md`, and `packages/orchestrator/locale/en.json`.
- `tsconfig.json` (root): add the `./packages/orchestrator` reference.
- `tsconfig.base.json`: add the `dsh-plugin-local-infer/orchestrator` path to
  `./packages/orchestrator/src`.
- `packages/bundle/package.json`: add the `dsh-plugin-local-infer-orchestrator`
  workspace dependency.
- Run `pnpm install`.

Definition of Done: `pnpm install`, `pnpm typecheck`, and `pnpm build` pass;
`packages/orchestrator/lib/index.js` is emitted; the five root-package files
above each carry their new rows; one commit.

## Answered open questions

(none specific to this task; the questionnaire answers landed in
PLAN-orchestrator.md on 2026-11-04)
