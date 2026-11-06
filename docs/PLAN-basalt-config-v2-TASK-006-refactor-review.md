# TASK-006: Refactor review of the config v2 commits

```text
Review the files touched by the previous 5 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.
```

## Notes for this review

- Watch for a second source of truth on the v2 shape: the block names, the
  `models[0].model` key, and `BASALT_CONFIG_VERSION` should each live once.
- Watch for JSON parse/stringify duplication between renderLaunch (envelope
  order) and deploy (model swap); lift a shared helper if they diverge.

## Definition of Done

- Each risk above is either resolved with a commit or recorded as not present.
- Package tests stay green; `lib/` rebuilt when `src/` changes.

## Definition of Done reference

See PLAN-basalt-config-v2.md verification guidelines.
