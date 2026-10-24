import type { LaunchPlan } from './adapter.ts';
/**
 * formatLaunchCommand renders a launch plan as the shell command string the
 * deploy step runs to start the engine: the quoted argv joined for a process
 * or docker plan, or the `docker compose up` line for a compose plan. The
 * card's Logs section shows the line above the engine's own output, so a
 * user can read and copy the exact binary and arguments a launch started
 * with. The Hyper-Qwen deploy runs this same string, so the printed line and
 * the host command cannot drift. Returns undefined when the plan names no
 * command (a non-compose plan with no argv).
 */
export declare function formatLaunchCommand(plan: LaunchPlan): string | undefined;
//# sourceMappingURL=launch-command.d.ts.map