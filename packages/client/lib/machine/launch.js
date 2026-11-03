/**
 * The per-entry provider launch state machine: the card's Launch/Stop
 * control lifecycle, ported 1:1 from the hand-written dsh/client.js.
 *
 * The states are the control's reads: idle (a plain Launch), the four
 * rebuild phases (prereqs, download, build, launch), downloading (a busy
 * throbber while the engine fetches model files), running (a Stop),
 * stopping (a disabled throbber while the stop is in flight), and failed
 * (a red Logs). launchNextState is the hardened transition: a step event
 * only advances forward through the rebuild phases (a stale or
 * out-of-order step is a no-op), a healthy result settles to running, a
 * failed result settles to failed, a stop moves a running (or idle, a
 * provider running per the summary with no machine entry) engine to
 * stopping, a confirmed stop settles to idle, a stop that is still
 * running at the deadline settles to failed with the cause 'stop', and a
 * break (the Logs control, a navigation away) resets: a launch failure
 * reads as Launch (idle), a stop timeout reads as Stop (running), because
 * the engine is probably still up. The machine takes the entry
 * ({status, cause}) and returns the next entry, so the cause-aware reset
 * stays in one place. An event that names no legal next state leaves the
 * control where it is, so a late event never corrupts it.
 * @module dsh-plugin-local-infer/client/machine/launch
 */
// The rebuild phases in the order the launch route streams them. A step
// event only advances forward through this order; a stale or out-of-order
// step is a no-op.
export const LAUNCH_STEP_ORDER = {
    prereqs: 0,
    download: 1,
    build: 2,
    launch: 3,
};
/** The four rebuild phase states, in step order. */
export const LAUNCH_PHASE_STATES = [
    'prereqs',
    'download',
    'build',
    'launch',
];
// The health-poll deadline: the route's poll runs up to two minutes, so a
// client-side deadline just past that cap forces a hung launch to the red
// Logs state. It arms only for the launch phase; the rebuild phases
// (prereqs, download, build) run as long as they need to, so a slow build
// never reads as a failure.
export const LAUNCH_HEALTH_DEADLINE_MS = 150000;
// The stop-poll interval: while a stop is in flight, the card re-fetches
// the summary on this cadence so the provider's status dot repaints the
// moment the engine is down, instead of waiting out the host's 5-second
// process-watch and probe cycle.
export const STOP_POLL_MS = 1000;
// The stop deadline: a provider still running 10 seconds after a Stop
// click settles to the red Logs state (the same path a failed launch
// takes), so the user can open the entry, fix the config, and retry.
export const STOP_HEALTH_DEADLINE_MS = 10000;
/** launchIsPhase reports whether a state is one of the four rebuild phases. */
export function launchIsPhase(state) {
    return LAUNCH_PHASE_STATES.includes(state);
}
// isLaunchStep reports whether a step name names one of the four rebuild
// phases. The step field is a plain string (the NDJSON stream carries
// server step names), so the machine guards before indexing the order map.
function isLaunchStep(step) {
    return step in LAUNCH_STEP_ORDER;
}
/**
 * launchNextState computes the machine's next entry from the current entry
 * and an event. A null or undefined entry prices as idle, so a provider
 * running per the summary with no machine entry can be stopped.
 */
export function launchNextState(entry, event) {
    const current = entry?.status ?? 'idle';
    const cause = entry?.cause;
    // The no-op default: an event type the union has not named yet (a late
    // event from an older card) leaves the control where it is.
    let next = current;
    let nextCause = cause;
    switch (event.type) {
        case 'start': {
            // A launch begins from idle (a plain Launch), failed (a re-launch
            // after the Logs control cleared the failed state), or downloading
            // (a re-poll while the engine fetches its model files).
            next =
                current === 'idle' || current === 'failed' || current === 'downloading'
                    ? 'prereqs'
                    : current;
            nextCause = undefined;
            break;
        }
        case 'step': {
            const target = event.step;
            if (!isLaunchStep(target)) {
                // An unknown step name is a no-op.
                next = current;
                nextCause = cause;
            }
            else if (current === 'idle' || current === 'failed') {
                next = target;
                nextCause = undefined;
            }
            else if (current === 'running' || current === 'stopping') {
                // A stop in flight supersedes a late launch step.
                next = current;
                nextCause = cause;
            }
            else if (!isLaunchStep(current)) {
                // downloading has no step order, so a late step is a no-op.
                next = current;
                nextCause = cause;
            }
            else {
                // A step only advances forward through the rebuild phases.
                next = LAUNCH_STEP_ORDER[target] >= LAUNCH_STEP_ORDER[current] ? target : current;
                nextCause = undefined;
            }
            break;
        }
        case 'healthy': {
            next = launchIsPhase(current) ? 'running' : current;
            nextCause = undefined;
            break;
        }
        case 'failed': {
            next = launchIsPhase(current) ? 'failed' : current;
            nextCause = undefined;
            break;
        }
        case 'downloading': {
            // The engine is fetching its model files: a busy throbber, not a
            // failure. The card re-polls (a re-launch) until the engine reports
            // ready, which settles the control to running.
            next = launchIsPhase(current) ? 'downloading' : current;
            nextCause = undefined;
            break;
        }
        case 'stop': {
            // A stop moves a running engine (or an idle one running per the
            // summary, or a launch in flight) to the stopping state; a stop
            // already in flight is a no-op.
            next =
                current === 'running' ||
                    current === 'stopping' ||
                    current === 'idle' ||
                    launchIsPhase(current)
                    ? 'stopping'
                    : current;
            nextCause = undefined;
            break;
        }
        case 'stopped': {
            // The fast poll confirmed the provider is no longer running.
            next = current === 'stopping' ? 'idle' : current;
            nextCause = undefined;
            break;
        }
        case 'stopFailed': {
            // The deadline fired while the provider was still running.
            next = current === 'stopping' ? 'failed' : current;
            nextCause = current === 'stopping' ? 'stop' : cause;
            break;
        }
        case 'reset': {
            // A launch failure reads as Launch (idle); a stop timeout reads as
            // Stop (running), because the engine is probably still up.
            next = current === 'failed' ? (cause === 'stop' ? 'running' : 'idle') : 'idle';
            nextCause = undefined;
            break;
        }
    }
    return { status: next, cause: nextCause };
}
//# sourceMappingURL=launch.js.map
