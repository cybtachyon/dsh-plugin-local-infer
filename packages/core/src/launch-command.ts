import type { LaunchPlan } from './adapter.ts'

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
export function formatLaunchCommand(plan: LaunchPlan): string | undefined {
  if (plan.kind === 'compose') {
    // The compose defaults match the adapter's renderLaunch fallbacks, so a
    // plan built from a bare config still spells a runnable command.
    return [
      'docker',
      'compose',
      '-f',
      plan.composeFile ?? 'docker-compose.yml',
      '--profile',
      plan.profile ?? 'single',
      'up',
      '--pull',
      'always',
      '-d',
    ]
      .map(quoteArg)
      .join(' ')
  }
  const argv = plan.argv
  if (argv === undefined || argv.length === 0) return undefined
  return argv.map(quoteArg).join(' ')
}

/**
 * quoteArg renders one argv token for display: a token made only of shell-
 * safe characters rides bare, anything else lands in single quotes with
 * embedded quotes escaped, so the printed line pastes back into a shell
 * unchanged.
 */
function quoteArg(token: string): string {
  if (token !== '' && /^[A-Za-z0-9@%+=:,./_-]+$/.test(token)) return token
  return `'${token.replaceAll("'", "'\\''")}'`
}
