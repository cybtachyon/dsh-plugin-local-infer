# T1.3 `src/machine/launch.ts`.

Port `LAUNCH_STEP_ORDER`,
`LAUNCH_PHASE_STATES`, the three deadline constants, `launchIsPhase`,
and `launchNextState` with typed `LaunchStatus`, `LaunchEvent`,
`LaunchEntry` (`{ status, cause? }`).

**DoD:** table-driven unit tests cover every (state x event) pair,
including the cause-aware `reset` (failed+stop cause -> running),
out-of-order `step` no-ops, and `stop` superseding a launch phase;
`pnpm build` green.
