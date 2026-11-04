# TASK-007: full verification

Run the repo gates over the finished tree (see AGENTS.md Testing
Instructions): `pnpm build`, `pnpm test`, `pnpm test:coverage` (thresholds
in vitest.config.ts), `pnpm lint`. Confirm the tracked `lib/` outputs carry
every `src/` change (delete stale `tsconfig.tsbuildinfo` files if `tsc -b`
reports up to date over missing outputs).

Behavioral spot check (no live GPU needed): from a vitest scratch run,
price `providerStatuses`-style inputs with a basalt process line that
carries no port number and a launchedModels tie, and confirm the resolver
answers `running` (the D1+D2+D3 chain), and `unsure` for a foreign basalt
process (no tie).

Definition of done: all gates green; commit any remaining churn.

Depends on: TASK-006.
