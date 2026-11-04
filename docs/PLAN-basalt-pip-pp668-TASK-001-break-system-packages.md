# TASK-001: Add --break-system-packages to the basaltPip pip install

## Context

The `basaltPip` system dep (`packages/providers/src/systemDeps.ts`, `basaltPip`)
installs the Basalt serve requirements via `python3 -m pip install …`. On a PEP
668 host (Arch / CachyOS, Debian 12+, Ubuntu 23.04+), the system `python3` is
"externally managed," so the install fails with `externally-managed-environment`
unless `--break-system-packages` is passed.

## Work

In `packages/providers/src/systemDeps.ts`, `basaltPip`, the install commands:

1. Add `--break-system-packages` to the apt/dnf/pacman pip install commands:
   - `apt`: `sudo apt-get install -y python3-pip && sudo python3 -m pip install --break-system-packages numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
   - `dnf`: `sudo dnf install -y python3-pip && sudo python3 -m pip install --break-system-packages numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
   - `pacman`: `sudo pacman -S --noconfirm python-pip && sudo python3 -m pip install --break-system-packages numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil`
2. Keep the `brew` and `winget` install commands unchanged (the brew and winget
   python interpreters are not externally managed, so `--break-system-packages`
   is not needed).
3. Update the `deps.spec.ts` test that asserts the `basaltPip` install commands
   to expect the `--break-system-packages` flag on apt/dnf/pacman.

## Definition of Done

- The `basaltPip` dep's apt/dnf/pacman pip install commands pass
  `--break-system-packages`, so the install works on a PEP 668 host.
- The test that asserts the `basaltPip` install commands is updated.
- The task is checked `[x]` in `PLAN-basalt-pip-pp668.md`.
