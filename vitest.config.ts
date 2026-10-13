import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// tsconfig.base.json has no `include`, which vite-tsconfig-paths treats as
// match-all, so its paths map applies to every test file. Paths must win over
// package `exports` so a built `lib/` never loads a second module-singleton copy.
// Coverage thresholds start modest for the scaffold and are raised to 100% in
// the hardening phase (Phase 9), matching the codegraph baseline.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
