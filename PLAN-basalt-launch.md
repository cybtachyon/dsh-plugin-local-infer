# Basalt launch hang: diagnosis and fix

The `basalt` engine (a new provider) builds correctly but its launch hangs.
Root cause: the CMake `basalt` target writes its executable to
`${CMAKE_SOURCE_DIR}/bin`, but the plugin's Basalt OS profiles declare
`buildDir: 'build'`. The launch therefore spawns a bare `basalt` (PATH-resolved)
that is never on the PATH, so the engine never starts; the health poll then reads
a foreign engine on the same port (false "ready") or runs the full 120-attempt
poll (the perceived hang). A secondary bug writes `basalt_config.json` relative
to the host cwd instead of the engine dir the spawn runs in.

## Verification guidelines
- `pnpm build` must pass (tsc -b + client bundle + format).
- `pnpm test` must pass, including `packages/providers/tests/basalt.spec.ts`.
- A live launch of the stored basalt provider must spawn
  `~/.cache/huggingface/hub/basalt/bin/basalt` and write
  `~/.cache/huggingface/hub/basalt/basalt_config.json`.
- Do not duplicate rules already in `AGENTS.md`.

## Open questions
- None. The fix is determined by the CMake `RUNTIME_OUTPUT_DIRECTORY` (`bin`)
  and the observed `spawn basalt ENOENT` + foreign-port health read.

## Micro-tasks

### Phase 1: Data fix (the binary location)
- [x] TASK-001: Set `buildDir: 'bin'` in `basaltLinux.ts` (the macOS profile reuses it).
- [x] TASK-002: Set `buildDir: 'bin'` in `basaltWindows.ts`.

### Phase 2: Adapter fix (resolve the binary and the config file)
- [x] TASK-003: In `BasaltAdapter.renderLaunch`, spell the launch binary as a
  build-tree-relative path (`bin/basalt`, `bin/basalt.exe`) via `engineBuildDir`,
  so `resolveLaunchArgv` joins it against the engine directory at deploy.
- [x] TASK-004: In `BasaltAdapter.deploy`, resolve a relative `configFile.path`
  against the engine directory before `host.writeFile`, so the engine (whose
  cwd is the engine dir) finds `basalt_config.json`.

### Phase 3: Tests
- [x] TASK-005: Update `basalt.spec.ts`: `buildDir` assertions to `'bin'`;
  `renderLaunch` argv[0] to `bin/basalt` / `bin/basalt.exe`; the deploy spawn
  argv[0] to the engine-dir-joined `bin/basalt`; the relative-binary test to
  `bin/basalt`.

### Phase 4: Verify
- [x] TASK-006: `pnpm build` and `pnpm test` pass.
- [x] TASK-007: Live launch repro spawns `bin/basalt` and writes the config into
  the engine dir; the health check reads the real engine, not a foreign port.

### Phase 5: Refactor review
- [x] TASK-008: Review the files touched by the previous 4 commits for the code
  risks (multiple sources of truth, duplicate code, bloaters, data clumps,
  shotgun edits, feature envy, magic numbers) and resolve each.

### Finalize
- [x] TASK-009: Commit the fix, remove this plan file, present results.
