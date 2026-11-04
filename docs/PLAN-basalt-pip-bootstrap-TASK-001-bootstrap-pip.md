# TASK-001: Bootstrap pip in the basaltPip dep

## Context

The `basaltPip` system dep (`packages/providers/src/systemDeps.ts`, `basaltPip`)
installs the Basalt serve requirements via `python3 -m pip install …`. On a host
where the system `python3` lacks the `pip` module (e.g. CachyOS / Arch, where
`python3` is installed without `python-pip`), the install fails with
`/usr/bin/python3: No module named pip`.

## Work

In `packages/providers/src/systemDeps.ts`, `basaltPip`, the install commands:

1. Bootstrap `pip` via the package manager before installing the requirements:
   - `apt`: `sudo apt-get install -y python3-pip && sudo python3 -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
   - `dnf`: `sudo dnf install -y python3-pip && sudo python3 -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
   - `pacman`: `sudo pacman -S --noconfirm python-pip && sudo python3 -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
2. Keep the `brew` and `winget` install commands unchanged (the brew and winget
   python interpreters ship with `pip`).
3. Update the `deps.spec.ts` test that asserts the `basaltPip` install commands
   (TASK-004 of the prior plan) to expect the pip-bootstrap commands on
   apt/dnf/pacman.

## Definition of Done

- The `basaltPip` dep's install commands bootstrap `pip` (via the package
  manager) before installing the requirements, so the install works on a host
  where `python3` has no `pip` module.
- The test that asserts the `basaltPip` install commands is updated.
- The task is checked `[x]` in `PLAN-basalt-pip-bootstrap.md`.
