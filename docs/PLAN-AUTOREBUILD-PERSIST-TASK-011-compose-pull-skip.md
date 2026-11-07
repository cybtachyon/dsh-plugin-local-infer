# TASK-011 - Compose launch honors Auto Rebuild off (Hyper-Qwen)

Inserted after TASK-004: the compose engine's `docker compose up` always
re-pulls, so an unchecked provider still fetches the vLLM image.

- `packages/core/src/launch-command.ts` `formatLaunchCommand(plan, autoRebuild?:
  boolean)`: in the compose default branch, render `--pull always` when the flag
  is absent/true and `--pull missing` when false (compose then starts the
  already-present image with the plan's parameters). The user's `composeArgs`
  branch (docker-tag override) is unchanged. Keep the single-source doc: the
  printed Logs line and the deploy's run must stay the same string.
- `packages/providers/src/engines/hyperqwen/hyperqwenAdapter.ts` deploy: pass
  `options?.autoRebuild !== false` into `formatLaunchCommand`; when the flag is
  false, skip the `onProgress?.('build')` announcement (spawn-only launch, the
  same rule the guarded `docker pull` adapters follow).
- `packages/ui/src/ops/engine.ts`: compute the effective `launchAutoRebuild`
  (syncFailed override included) before `launchCommandNote(plan)` renders, and
  thread that same value into the formatter, so the persisted launch line
  matches the command the deploy runs.
- DoD: core launch-command tests (`--pull missing` when false, `--pull always`
  when absent/true, composeArgs branch untouched); Hyper-Qwen deploy tests
  (flag false: `up` command recorded without `--pull always` and no `build`
  phase; flag absent: unchanged legacy line); an engine.ts pin that the
  persisted command note carries the same pull policy as the deploy. Commit
  with tracked emitted outputs.
