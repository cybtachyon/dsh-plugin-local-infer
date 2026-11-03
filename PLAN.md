# Plan: Add Basalt as a first-class provider engine

This is a thin index of the work. Each task is its own file under `docs/`;
open the linked file for the task's description and Definition of Done.

## Background

Basalt (https://github.com/jesdga95/basalt) is a local-inference engine for the
Qwen3.8-Flash-Next mixture-of-experts model. It is a C++/CUDA engine
(`bin/basalt`) plus a Python server (`serve/`) with an OpenAI- and
Anthropic-compatible API. It runs on Linux x64 and Windows x64 with an NVIDIA
Blackwell GPU (sm_120) and CUDA 13.

- **Build**: `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release` then
  `cmake --build build -j` (Windows adds `-G Ninja`), then
  `pip install -r requirements.txt`. Toolchain: CMake 3.24+, a C++20 compiler
  (GCC/Clang on Linux, Visual Studio 2022 / MSVC 19.44 on Windows), CUDA 13,
  Python 3.10+. The build needs nothing outside the repository.
- **Launch**: `bin/basalt serve --config basalt_config.json`. The server
  listens on `127.0.0.1:8080`; `/health` reports `loading` until ready, then
  `200`.
- **Model**: one `.basalt` file, downloaded with
  `hf download jesdga/Qwen3.8-Flash-Next-Basalt Qwen3.8-FN-NVFP4-DQ6_K.basalt`.
- **Configuration**: a JSON file `basalt_config.json` with `server` and `engine`
  blocks. Precedence is command line > config file > built-in defaults.
- **Blackwell-only**: requires an NVIDIA Blackwell GPU (sm_120).

Two cross-cutting refactors are prerequisites for Basalt and apply to every
existing engine (ninfer, hyperqwen, llamacpp, infernix, strata): a
**config-file deployment target** on `ParameterSpec` (Phase 1) and
**per-platform build dependencies** in each engine's `{{engine}}{{Platform}}.ts`
profile (Phase 2). The engine itself follows the Strata / NInfer shape: a
`{{engine}}.ts` surface, a `{{engine}}Adapter.ts`, and
`{{engine}}{Linux,MacOS,Windows}.ts` OS profiles, registered in `engines.ts`,
`acquire.ts`, `platform.ts`, `model-defaults.ts`, and the provider `apply()`.

Verification for the whole plan: `pnpm build`, `pnpm test` (must clear the
coverage thresholds in `vitest.config.ts`), and `pnpm lint`.

---

## Phase 1 — Refactor: config-file deployment target

| # | Task | File |
| --- | --- | --- |
| 001 | Add the `ParameterDeploy` type and `deploy` field to `ParameterSpec` | [docs/PLAN-TASK001-parameter-deploy-target.md](docs/PLAN-TASK001-parameter-deploy-target.md) |
| 002 | Add a `configFile` field to `LaunchPlan` | [docs/PLAN-TASK002-launchplan-config-file.md](docs/PLAN-TASK002-launchplan-config-file.md) |
| 003 | Add a `writeFile` method to `LifecycleHost` | [docs/PLAN-TASK003-lifecycle-host-write-file.md](docs/PLAN-TASK003-lifecycle-host-write-file.md) |
| 004 | Add a config-file renderer to the shared adapter helpers | [docs/PLAN-TASK004-config-file-renderer.md](docs/PLAN-TASK004-config-file-renderer.md) |
| 005 | Migrate every existing engine's `ParameterSpec` to declare `deploy` | [docs/PLAN-TASK005-migrate-engines-deploy.md](docs/PLAN-TASK005-migrate-engines-deploy.md) |

Order: 001 → 002 → 003 → 004 → 005 (005 last, so the helpers exist before the
migration).

## Phase 2 — Refactor: per-platform build dependencies

| # | Task | File |
| --- | --- | --- |
| 006 | Add a `deps` field to `EngineOsProfile` | [docs/PLAN-TASK006-engine-os-profile-deps.md](docs/PLAN-TASK006-engine-os-profile-deps.md) |
| 007 | Migrate every existing engine's OS profiles to declare `deps` | [docs/PLAN-TASK007-migrate-os-profile-deps.md](docs/PLAN-TASK007-migrate-os-profile-deps.md) |
| 008 | Refactor the dep-plan resolution to read per-platform deps | [docs/PLAN-TASK008-dep-plan-resolution.md](docs/PLAN-TASK008-dep-plan-resolution.md) |

Order: 006 → 007 → 008.

## Phase 3 — The Basalt engine

| # | Task | File |
| --- | --- | --- |
| 009 | Add the Basalt parameter surface | [docs/PLAN-TASK009-basalt-parameter-surface.md](docs/PLAN-TASK009-basalt-parameter-surface.md) |
| 010 | Add the Basalt OS profiles | [docs/PLAN-TASK010-basalt-os-profiles.md](docs/PLAN-TASK010-basalt-os-profiles.md) |
| 011 | Add the Basalt adapter | [docs/PLAN-TASK011-basalt-adapter.md](docs/PLAN-TASK011-basalt-adapter.md) |
| 012 | Register Basalt across the provider registries | [docs/PLAN-TASK012-register-basalt.md](docs/PLAN-TASK012-register-basalt.md) |
| 013 | Add Basalt VRAM / preset / guideline data | [docs/PLAN-TASK013-basalt-vram-guideline.md](docs/PLAN-TASK013-basalt-vram-guideline.md) |
| 014 | Add the Basalt test suite | [docs/PLAN-TASK014-basalt-test-suite.md](docs/PLAN-TASK014-basalt-test-suite.md) |

Order: 009 → 010 → 011 → 012 → 013 → 014, on top of both Phase 1 and Phase 2.

## Phase 4 — Codebase quality and maintainability

| # | Task | File |
| --- | --- | --- |
| 015 | Route the Strata adapter's inline config reads through the parameter surface | [docs/PLAN-TASK015-strata-surface-config-reads.md](docs/PLAN-TASK015-strata-surface-config-reads.md) |
| 016 | Harden the node `spawn` against a missing `argv[0]` | [docs/PLAN-TASK016-node-spawn-empty-argv.md](docs/PLAN-TASK016-node-spawn-empty-argv.md) |
| 017 | Record the Basalt build-dependency list as a tracked to-do | [docs/PLAN-TASK017-basalt-build-deps-todo.md](docs/PLAN-TASK017-basalt-build-deps-todo.md) |

Order: 015 → 016 → 017, after the engine lands.

---

Phases 1 and 2 are independent of each other and both precede Phase 3. Phase 4
is independent and can land after Phase 3.
