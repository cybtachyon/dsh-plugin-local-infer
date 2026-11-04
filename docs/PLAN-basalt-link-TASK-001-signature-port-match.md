# TASK-001: core signature port-in-argv option

Adds `portInArgv` to the launch signature so an engine whose port rides a
config file (not argv) can skip the command-line port element.

Files: `packages/core/src/reserve.ts`, `packages/core/tests/reserve.spec.ts`.

Changes:

- `EngineLaunchSignature`: add optional `portInArgv?: boolean`. Doc comment:
  when false the engine binds its port from a file (Basalt's
  `basalt_config.json` server block), so the matcher never sees the number
  in the command line and must skip the port element. Undefined reads as
  true (the port must appear as a standalone number, the current rule).
- `matchLaunchSignature`: gate the `portAppears` check on
  `signature.portInArgv !== false`.
- Tests (reserve.spec.ts): a line with the binary but not the port matches
  when `portInArgv: false`; the same line does not match when the flag is
  absent; the binary element still rules when `portInArgv: false`.

Definition of done: `pnpm vitest run packages/core/tests/reserve.spec.ts`
passes; `pnpm build` lands the tracked `packages/core/lib` outputs; commit.

Depends on: none.
