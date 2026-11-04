# TASK-005: build-format-dead-fallback

## Context

Pre-existing issue found by the TASK-004 subagent: line 25 of
`scripts/build-format.mjs` reads

```js
const currentDir = entry.parentPath || entry.path;
```

`Dirent.path` is not a standard property of the objects `fs.readdir` returns with
`withFileTypes: true`; the standard property is `parentPath`, which is always
defined on the Node versions this repo requires (`^22.19.0 || >=24.0.0`). The
`|| entry.path` fallback is dead code.

## Work

1. Reduce line 25 to `const currentDir = entry.parentPath;`.
2. Run `pnpm build` and confirm `git status --short` is clean.
3. Commit the change.

## Definition of Done

- `scripts/build-format.mjs` carries no `entry.path` reference.
- `pnpm build` leaves the tree clean.
- The change is committed.
