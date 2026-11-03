import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readConfigFile } from 'typescript'
import { defineConfig } from 'vitest/config'

// The tests import the sub-packages by their bare specifiers
// (dsh-plugin-local-infer/core and friends). Vite's native tsconfig paths
// resolution (resolve.tsconfigPaths) only applies a tsconfig's paths map to
// the files that tsconfig covers, and the package tsconfigs cover src/ only.
// The tests in packages/*/tests (and the bundle package, which has no
// tsconfig) would fall through to the package exports and load a second copy
// of the built lib/. The alias below maps the same specifiers to the source
// directories, derived from the tsconfig.base.json paths map so it stays the
// single source of truth. Paths must win over package exports for the same
// module-singleton reason.
const baseFile = fileURLToPath(new URL('./tsconfig.base.json', import.meta.url))
const base = readConfigFile(baseFile, (fileName) =>
  readFileSync(fileName, 'utf8'),
).config
const paths = base?.compilerOptions?.paths ?? {}
const alias = Object.entries(paths).map(([find, targets]) => ({
  find,
  replacement: fileURLToPath(new URL(targets[0], import.meta.url)),
}))

// Coverage thresholds start modest for the scaffold (80% across the board) and
// are raised in the hardening phase (Phase 9) to a level the suite clears with
// a buffer: lines, functions, and statements above 90%, branches above 78%.
// The codegraph 100% per-file baseline is the long-term target; the UI route
// handler matrix and the node host live implementation are the remaining drag.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias,
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      thresholds: { lines: 90, functions: 93, branches: 78, statements: 90 },
    },
  },
})
