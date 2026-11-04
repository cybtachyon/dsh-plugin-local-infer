# TASK-001: Fix the basaltPip dep to target the system python

## Context

The `basaltPip` system dep (`packages/providers/src/systemDeps.ts`, `basaltPip`)
probes and installs the Basalt serve server's Python requirements via `uv`:

- Probe: `uv run python -c 'import regex, numpy, jinja2, yaml, tqdm, PIL, psutil'`
- Install: `uv pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`

The `uv` command manages its own environment, so the packages land in the `uv`
env. But the basalt serve CLI resolves its python as `<src_dir>/.venv/bin/python`
if present, else the system `python3` (`src/platform/system.cpp`,
`python_interpreter`). So the packages are not available to the serve CLI, and
the server fails at `import regex` with `ModuleNotFoundError`.

## Work

In `packages/providers/src/systemDeps.ts`, `basaltPip`:

1. Change the probe to target the system python (the serve CLI's fallback), not
   `uv run python`. Use `python3 -c 'import regex, numpy, jinja2, yaml, tqdm,
   PIL, psutil'` (or the `probe` helper's equivalent for a bare `python3`
   command), so the probe reports the state of the environment the serve CLI
   actually reads.
2. Change the install to target the system python, not `uv pip install`. Use
   `python3 -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow
   psutil` (with `--system` where the package manager requires it), so the
   packages land in the system python the serve CLI falls back to.
3. Keep the `requiresSudo: true` flag (a system-python install needs root).
4. Update the dep's comment to name the system-python target and the reason
   (the serve CLI's `python_interpreter` fallback).

## Definition of Done

- The `basaltPip` dep's probe and install target the system python (the serve
  CLI's `python_interpreter` fallback), so the `regex` module and the other
  Basalt serve requirements are importable by the serve CLI.
- The task is checked `[x]` in `PLAN-basalt-serve-dep.md`.
