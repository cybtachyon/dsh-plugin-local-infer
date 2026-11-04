# PLAN: Add --break-system-packages to the basaltPip pip install

## Objective

The `basaltPip` system dep (`packages/providers/src/systemDeps.ts`) installs the
Basalt serve requirements via `python3 -m pip install …`. On a PEP 668 host
(Arch / CachyOS, Debian 12+, Ubuntu 23.04+), the system `python3` is
"externally managed," so the install fails with `externally-managed-environment`
unless `--break-system-packages` is passed. The fix adds `--break-system-packages`
to the apt/dnf/pacman pip install commands, so the install works on a PEP 668
host.

## Verification guidelines

- The `basaltPip` dep's apt/dnf/pacman pip install commands pass
  `--break-system-packages`, so the install works on a PEP 668 host.
- `pnpm build`, `pnpm test`, and `pnpm lint` must pass.

## Open questions

(none; the diagnosis is complete and the fix is determined by the PEP 668 contract)

## Task dependencies

- TASK-001 (break-system-packages) is independent.
- TASK-002 (build/test/lint) depends on TASK-001.

## Tasks

### Phase 1: break-system-packages

- [x] [TASK-001-break-system-packages](docs/PLAN-basalt-pip-pp668-TASK-001-break-system-packages.md)

### Phase 2: Verification

- [x] [TASK-002-build-test-lint](docs/PLAN-basalt-pip-pp668-TASK-002-build-test-lint.md)
