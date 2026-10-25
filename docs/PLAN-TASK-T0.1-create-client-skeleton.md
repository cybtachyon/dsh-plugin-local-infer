# T0.1 Create the `packages/client` skeleton.

Add `packages/client/package.json` (name `dsh-plugin-local-infer-client`,
`private: true`, `type: module`), `packages/client/tsconfig.json`
(extends `tsconfig.base.json`, `rootDir: src`, `outDir: lib`,
`jsx: 'react'`, `jsxFactory: 'react.createElement'`,
`jsxFragmentFactory: 'react.Fragment'`, references `../ui`), a stub
`src/index.ts` (`export const apply = () => {}; export const inject:
string[] = [];`), and an empty `tests/` dir with one trivial spec.
Add the project to the root `tsconfig.json` `references` and the
`dsh-plugin-local-infer/client` path alias to `tsconfig.base.json`
(paths map only; never add `include`/`files` there).

**DoD:** `pnpm build` succeeds and emits `packages/client/lib/`; the
trivial spec passes under `pnpm test`; `pnpm lint` passes.
