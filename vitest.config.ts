import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// tsconfig.base.json has no `include`, which vite-tsconfig-paths treats as
// match-all, so its paths map applies to every test file. Paths must win over
// package `exports` so a built `lib/` never loads a second module-singleton copy.
// Coverage thresholds start modest for the scaffold (80% across the board) and
// are raised in the hardening phase (Phase 9) to a level the suite clears with
// a buffer: lines, functions, and statements above 90%, branches above 78%.
// The codegraph 100% per-file baseline is the long-term target; the UI route
// handler matrix and the node host live implementation are the remaining drag.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      thresholds: { lines: 90, functions: 93, branches: 78, statements: 90 },
    },
  },
})
