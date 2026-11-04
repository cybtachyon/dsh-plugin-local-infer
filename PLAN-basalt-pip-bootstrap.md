# PLAN: Bootstrap pip in the basaltPip dep

## Objective

The `basaltPip` system dep (`packages/providers/src/systemDeps.ts`) installs the
Basalt serve requirements via `python3 -m pip install …`, but the system
`python3` may lack the `pip` module (e.g. CachyOS / Arch, where `python3` is
installed without `python-pip`). The install then fails with
`/usr/bin/python3: No module named pip`. The fix bootstraps `pip` (via the
package manager's `python-pip` / `python3-pip` package) before installing the
requirements, so the install works on a host where `python3` has no `pip`.

## Verification guidelines

- The `basaltPip` dep's install commands bootstrap `pip` (via the package
  manager) before installing the requirements, so the install works on a host
  where `python3` has no `pip` module.
- `pnpm build`, `pnpm test`, and `pnpm lint` must pass.

## Open questions

(none; the diagnosis is complete and the fix is determined by the host state)

## Task dependencies

- TASK-001 (bootstrap pip) is independent.
- TASK-002 (build/test/lint) depends on TASK-001.

## Tasks

### Phase 1: Bootstrap pip

- [x] [TASK-001-bootstrap-pip](docs/PLAN-basalt-pip-bootstrap-TASK-001-bootstrap-pip.md)

### Phase 2: Verification

- [ ] [TASK-002-build-test-lint](docs/PLAN-basalt-pip-bootstrap-TASK-002-build-test-lint.md)
