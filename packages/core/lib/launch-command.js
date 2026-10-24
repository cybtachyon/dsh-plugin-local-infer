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
export function formatLaunchCommand(plan) {
    if (plan.kind === 'compose') {
        // The user's compose arguments (the card's docker-tag field) override the
        // default profile: the flags the up step runs before the required `up -d`.
        // An empty field reads as "use the default profile", so the up step falls
        // back to the engine's own default.
        const composeArgs = plan.composeArgs?.split(/\s+/).filter((token) => token !== '');
        if (composeArgs !== undefined && composeArgs.length > 0) {
            return [
                'docker',
                'compose',
                '-f',
                plan.composeFile ?? 'docker-compose.yml',
                ...composeArgs,
                'up',
                '-d',
            ]
                .map(quoteArg)
                .join(' ');
        }
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
            .join(' ');
    }
    const argv = plan.argv;
    if (argv === undefined || argv.length === 0)
        return undefined;
    return argv.map(quoteArg).join(' ');
}
/**
 * quoteArg renders one argv token for display: a token made only of shell-
 * safe characters rides bare, anything else lands in single quotes with
 * embedded quotes escaped, so the printed line pastes back into a shell
 * unchanged.
 */
function quoteArg(token) {
    if (token !== '' && /^[A-Za-z0-9@%+=:,./_-]+$/.test(token))
        return token;
    return `'${token.replaceAll("'", "'\\''")}'`;
}
//# sourceMappingURL=launch-command.js.map