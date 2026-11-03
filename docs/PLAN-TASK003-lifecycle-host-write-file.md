# TASK 003 — Add a `writeFile` method to `LifecycleHost`

**Phase:** 1 — Refactor: config-file deployment target
**Depends on:** none

## What

Add to `packages/core/src/adapter.ts`:

- An optional `writeFile?(path: string, content: string): Promise<void>` method
  on `LifecycleHost`, so a deploy step can write the rendered config file.

Add to `packages/providers/src/adapters.ts`:

- A `writeFile` implementation on `createNodeLifecycleHost` (a
  `node:fs/promises` `writeFile`, creating the parent directory), and on the
  `nodeLifecycleHost` default.

## Definition of Done

- `pnpm build` type-checks; `writeFile` is optional on the interface, so a host
  that cannot write files (a test stub) omits it.
- The node host writes the file and creates missing parent directories.
- A unit test in `packages/providers/tests/adapters.spec.ts` (or a new
  `lifecycle.spec.ts`) runs a `writeFile` through the node host into a temp dir
  and asserts the file content, and asserts a stub host without `writeFile`
  leaves the plan un-written without throwing.
