# T0.3 Write `scripts/build-client.mjs` and wire it into `pnpm build`.

Implement the two-step pipeline in PLAN.md (Build pipeline: esbuild to
`dsh/.build/client.cjs`, wrap into `dsh/client.js` with the generated
header). Change the root `build` script to `tsc -b && node
scripts/build-client.mjs`. Add `dsh/.build/` to `.gitignore`.

**DoD:** `pnpm build` produces `dsh/client.js` whose first line is the
generated header and which contains
`window.__ModuleLoader__.load({ id: 'dsh-plugin-local-infer', factory:`;
`node --check dsh/client.js` exits 0; running `pnpm build` twice yields
a byte-identical `dsh/client.js` (idempotent).
