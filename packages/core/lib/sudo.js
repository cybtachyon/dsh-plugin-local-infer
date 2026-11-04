/**
 * The pure half of the sudo-prompt rule. A sudo command run by the plugin
 * prompts on the terminal that launched the host, where the card user cannot
 * see it, so the runners announce the prompt and cap how long it may wait.
 * This module holds the constants and the injected-callback guard both
 * runners drive; the child-process wiring stays in the service and the
 * providers, so core never touches node.
 * @module dsh-plugin-local-infer/core/sudo
 */
/**
 * SUDO_CLI_NOTE is the line the Logs section, the log file, and the streamed
 * run show when a sudo command is waiting for the user to type the password
 * on the CLI.
 */
export const SUDO_CLI_NOTE = 'Check your CLI for a sudo prompt';
/**
 * SUDO_PASSWORD_TIMEOUT_MS caps how long a sudo command may wait for the user
 * to type the password on the CLI before the run kills it and fails.
 */
export const SUDO_PASSWORD_TIMEOUT_MS = 60_000;
/**
 * SUDO_PROBE_COMMAND is the non-interactive probe that answers whether sudo
 * already holds cached credentials (exit 0) or is about to prompt on the
 * terminal (non-zero). The runners execute it; core only declares it.
 */
export const SUDO_PROBE_COMMAND = ['sudo', '-n', 'true'];
/**
 * sudoFailureDetail builds the CommandOutcome.detail text for a command the
 * sudo deadline killed, naming the CLI note and the timeout seconds so the
 * Logs section explains what the user missed.
 */
export function sudoFailureDetail(command) {
    return (`${command} was killed: no sudo password was entered within ` +
        `${SUDO_PASSWORD_TIMEOUT_MS / 1000} seconds. ${SUDO_CLI_NOTE}`);
}
/** DEFAULT_SUDO_TIMER is the guard clock when the caller injects none. */
const DEFAULT_SUDO_TIMER = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle),
};
/**
 * guardSudoCommand applies the shared sudo-prompt rule for one command, so
 * the service install runner and the providers lifecycle host drive one rule.
 * A command the caller does not declare sudo runs through unguarded: no
 * probe, no announcement, no timer. A declared command probes first; cached
 * credentials (probe resolves true) run through the same way. Otherwise the
 * guard calls notify once and arms the timeout whose fire calls kill.
 */
export async function guardSudoCommand(options) {
    if (options.needsSudo !== true) {
        return unguarded();
    }
    if (await options.probe()) {
        return unguarded();
    }
    options.notify(options.command);
    const timer = options.timer ?? DEFAULT_SUDO_TIMER;
    const timeoutMs = options.timeoutMs ?? SUDO_PASSWORD_TIMEOUT_MS;
    let timedOut = false;
    const handle = timer.set(() => {
        timedOut = true;
        options.kill();
    }, timeoutMs);
    return {
        announced: true,
        disarm: () => timer.clear(handle),
        timedOut: () => timedOut,
    };
}
/** unguarded is the pass-through guard for a run nothing was armed for. */
function unguarded() {
    return {
        announced: false,
        disarm: () => { },
        timedOut: () => false,
    };
}
//# sourceMappingURL=sudo.js.map
