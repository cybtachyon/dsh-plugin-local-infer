# PLAN: Fix the Basalt serve python-dep mismatch and the early-exit health poll

## Objective

Two faults remain after the Basalt launch fix:

1. **`ModuleNotFoundError: No module named 'regex'`** — the `basaltPip` system dep
   probes and installs the Basalt serve server's Python requirements via `uv`
   (its own environment), but the basalt serve CLI resolves its python as
   `<src_dir>/.venv/bin/python` if present, else the system `python3`
   (`src/platform/system.cpp`, `python_interpreter`). So the packages land in the
   `uv` env, not where the serve CLI looks, and the server fails at `import regex`.
2. **The launch process should end when the engine crashes** — if the engine
   process exits (a crash like the `ModuleNotFoundError`), the `pollHealth` loop
   runs the full 120-attempt timeout instead of ending immediately.

The fix makes the `basaltPip` dep probe and install in the environment the serve
CLI actually uses (the system python, matching `python_interpreter`'s fallback),
and makes the health poll stop early when the spawned engine process has exited.

## Verification guidelines

- The `basaltPip` dep's probe and install target the system python (the serve
  CLI's fallback), so the `regex` module (and the other Basalt serve
  requirements) are importable by the serve CLI.
- A launch whose engine process exits (crashes) ends immediately with a failed
  health result, not after the full 120-attempt timeout.
- `pnpm build`, `pnpm test`, and `pnpm lint` must pass.

## Open questions

(none; the diagnosis is complete and the fix is determined by the basalt
`python_interpreter` contract and the existing health-poll rule)

## Task dependencies

- TASK-002 (hasExited) depends on TASK-001 (dep fix, independent).
- TASK-001b (build block) depends on TASK-001 (dep fix).
- TASK-003 (early-exit poll) depends on TASK-002 (hasExited).
- TASK-004 (tests) depends on TASK-001, TASK-003.
- TASK-005 (build/test/lint) depends on TASK-004.

## Tasks

### Phase 1: Dep fix

- [x] [TASK-001-basalt-pip-system-python](docs/PLAN-basalt-serve-dep-TASK-001-basalt-pip-system-python.md)
- [x] [TASK-001b-basalt-linux-build-system-python](docs/PLAN-basalt-serve-dep-TASK-001b-basalt-linux-build-system-python.md)

### Phase 2: Early-exit health poll

- [x] [TASK-002-process-handle-has-exited](docs/PLAN-basalt-serve-dep-TASK-002-process-handle-has-exited.md)
- [x] [TASK-003-poll-health-early-exit](docs/PLAN-basalt-serve-dep-TASK-003-poll-health-early-exit.md)

### Phase 3: Tests and verification

- [x] [TASK-004-update-tests](docs/PLAN-basalt-serve-dep-TASK-004-update-tests.md)
- [ ] [TASK-005-build-test-lint](docs/PLAN-basalt-serve-dep-TASK-005-build-test-lint.md)
