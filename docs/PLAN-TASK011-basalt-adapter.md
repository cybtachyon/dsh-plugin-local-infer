# TASK 011 — Add the Basalt adapter

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 002, TASK 003, TASK 004, TASK 009, TASK 010

## What

Create `packages/providers/src/engines/basalt/basaltAdapter.ts`:

- `class BasaltAdapter extends EngineAdapter` with `id = 'basalt'` and
  `supports = { docker: false, local: true }`.
- `renderLaunch`: a `process` plan whose `argv` is
  `[<basalt binary>, 'serve', '--config', <configFile.path>]` (the binary name
  from the host OS profile, joined against the engine directory when relative),
  with `plan.configFile` set from `configFileFromSpecs(BASALT_PARAMETERS, config,
  'json')` and `healthUrl` of `http://127.0.0.1:<port>/health`.
- `deploy`: run the CMake build via `syncAndRebuildEngine` (the acquisition
  build steps), download the model with `hf download` into the model directory,
  write the config file via `host.writeFile`, then `spawn` the serve command and
  `trackChild` the handle.
- `healthCheck`: poll `/health` (reusing `pollHealth`), reporting the start
  phase from the tracked process output.
- `stop`: signal the tracked process.
- `modelRef`, `launchSignature` (the `basalt` binary + port), and `modelInput`
  (`['text','image']` when `vision` is not `off`, else `['text']`).

## Definition of Done

- `pnpm build` type-checks.
- A unit test renders a plan for a representative config and asserts the `argv`
  carries `serve` and `--config`, and that `plan.configFile.content` is the
  expected JSON; a second test runs `deploy` through a stub host and asserts the
  build step, the `hf download` command, the `writeFile` call, and the `spawn`
  argv all fire in order; a third asserts `stop` signals the tracked handle.
