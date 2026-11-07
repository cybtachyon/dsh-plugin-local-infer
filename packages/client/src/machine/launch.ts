/**
 * The per-entry provider launch state machine: the card's Launch/Stop
 * control lifecycle, ported 1:1 from the hand-written dsh/client.js.
 *
 * The states are the control's reads: idle (a plain Launch), the four
 * rebuild phases (prereqs, download, build, launch), downloading (a busy
 * throbber while the engine fetches model files), sudo (the host is
 * waiting for a sudo password on the terminal that launched the profile;
 * it is the same state whether the wait ends with the run resuming after
 * the user typed the password or with the host's 60-second timeout
 * settling to failed), running (a Stop), stopping (a disabled throbber
 * while the stop is in flight), and failed (a red Logs). launchNextState
 * is the hardened transition: a step event from the live run stream is
 * authoritative for the run's reported phase and sets it directly (the
 * host reports each phase as its work actually starts, and the real
 * sequences are not one fixed order), so the only guarded cases are the
 * in-flight states: a stop in flight supersedes a late step, the
 * downloading re-poll state ignores steps, and an unknown step name is a
 * no-op. A healthy result settles to running, a failed result settles to
 * failed, a stop moves a running (or idle, a provider running per the
 * summary with no machine entry) engine to stopping, a confirmed stop
 * settles to idle, a stop that is still running at the deadline settles
 * to failed with the cause 'stop', a sudoNeeded moves any in-flight state
 * to sudo (where a step resumes the run at the reported step, healthy and
 * failed settle as they do from a phase, a stop moves to stopping, and a
 * reset settles to idle), and a break (the Logs control, a navigation
 * away) resets: a launch failure reads as Launch (idle), a stop timeout
 * reads as Stop (running), because the engine is probably still up. The
 * machine takes the entry ({status, cause}) and returns the next entry,
 * so the cause-aware reset stays in one place. An event that names no
 * legal next state leaves the control where it is, so a late event never
 * corrupts it.
 * @module dsh-plugin-local-infer/client/machine/launch
 */

/** The rebuild phase a launch step event names. */
export type LaunchStep = 'prereqs' | 'download' | 'build' | 'launch'

/** The four rebuild phase states. The step names the stream can carry. */
export const LAUNCH_PHASE_STATES: readonly LaunchStep[] = [
  'prereqs',
  'download',
  'build',
  'launch',
]

// The health-poll deadline: the route's poll runs up to two minutes, so a
// client-side deadline just past that cap forces a hung launch to the red
// Logs state. It arms only for the launch phase; the rebuild phases
// (prereqs, download, build) run as long as they need to, so a slow build
// never reads as a failure.
export const LAUNCH_HEALTH_DEADLINE_MS = 150000

// The stop-poll interval: while a stop is in flight, the card re-fetches
// the summary on this cadence so the provider's status dot repaints the
// moment the engine is down, instead of waiting out the host's 5-second
// process-watch and probe cycle.
export const STOP_POLL_MS = 1000

// The stop deadline: a provider still running 10 seconds after a Stop
// click settles to the red Logs state (the same path a failed launch
// takes), so the user can open the entry, fix the config, and retry.
export const STOP_HEALTH_DEADLINE_MS = 10000

/** The launch control's states, as the control reads them. */
export type LaunchStatus =
  | 'idle'
  | LaunchStep
  | 'downloading'
  | 'sudo'
  | 'running'
  | 'stopping'
  | 'failed'

/** The cause a failed state carries: 'stop' marks a stop that timed out. */
export type LaunchCause = 'stop'

/** A provider's launch machine entry. */
export interface LaunchEntry {
  status: LaunchStatus
  // Explicit undefined: the machine returns {status, cause: undefined} for
  // cause-free entries, and exactOptionalPropertyTypes keeps that legal.
  cause?: LaunchCause | undefined
}

/** The events the machine consumes. */
export type LaunchEvent =
  | { type: 'start' }
  | { type: 'step'; step: string }
  | { type: 'healthy' }
  | { type: 'failed' }
  | { type: 'downloading' }
  | { type: 'sudoNeeded' }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'stopFailed' }
  | { type: 'reset' }

/** launchIsPhase reports whether a state is one of the four rebuild phases. */
export function launchIsPhase(state: LaunchStatus): state is LaunchStep {
  return LAUNCH_PHASE_STATES.includes(state as LaunchStep)
}

// isLaunchStep reports whether a step name names one of the four rebuild
// phases. The step field is a plain string (the NDJSON stream carries
// server step names), so the machine guards before trusting it.
function isLaunchStep(step: string): step is LaunchStep {
  return (LAUNCH_PHASE_STATES as readonly string[]).includes(step)
}

// The in-flight states a host password wait can interrupt: the four
// rebuild phases, the model fetch, or a sudo wait already in progress.
// A control at idle, running, stopping, or failed has nothing waiting on
// the terminal, so it ignores sudoNeeded.
const SUDO_WAITABLE_STATES: readonly LaunchStatus[] = [
  'prereqs',
  'download',
  'build',
  'launch',
  'downloading',
  'sudo',
]

// launchIsAwaitingResult reports whether a healthy or failed result
// settles the state: a rebuild phase, or a sudo wait (the run is still
// in flight, paused on the password or resumed by it). The downloading
// state waits on a re-poll instead, so it stays out.
function launchIsAwaitingResult(state: LaunchStatus): boolean {
  return launchIsPhase(state) || state === 'sudo'
}

/**
 * launchNextState computes the machine's next entry from the current entry
 * and an event. A null or undefined entry prices as idle, so a provider
 * running per the summary with no machine entry can be stopped.
 */
export function launchNextState(
  entry: LaunchEntry | null | undefined,
  event: LaunchEvent,
): LaunchEntry {
  const current: LaunchStatus = entry?.status ?? 'idle'
  const cause: LaunchCause | undefined = entry?.cause
  // The no-op default: an event type the union has not named yet (a late
  // event from an older card) leaves the control where it is.
  let next: LaunchStatus = current
  let nextCause: LaunchCause | undefined = cause
  switch (event.type) {
    case 'start': {
      // A launch begins from idle (a plain Launch), failed (a re-launch
      // after the Logs control cleared the failed state), or downloading
      // (a re-poll while the engine fetches its model files).
      next =
        current === 'idle' || current === 'failed' || current === 'downloading'
          ? 'prereqs'
          : current
      nextCause = undefined
      break
    }
    case 'step': {
      const target = event.step
      if (!isLaunchStep(target)) {
        // An unknown step name is a no-op.
        next = current
        nextCause = cause
      } else if (current === 'running' || current === 'stopping') {
        // A stop in flight supersedes a late launch step.
        next = current
        nextCause = cause
      } else if (current === 'downloading') {
        // The re-poll state reads the result's downloading verdict, not the
        // step stream, so a late step is a no-op here too.
        next = current
        nextCause = cause
      } else {
        // The server stream is authoritative for the run in flight: a
        // reported step sets the reported state directly (idle and failed
        // seed it, a phase moves to it, and a sudo wait resumes at it). The
        // host announces each phase as its work actually starts, so the
        // stream's order is the run's real order and needs no comparison.
        next = target
        nextCause = undefined
      }
      break
    }
    case 'healthy': {
      next = launchIsAwaitingResult(current) ? 'running' : current
      nextCause = undefined
      break
    }
    case 'failed': {
      // From sudo this is the 60-second password timeout: the wait and
      // the run it held both end in the red Logs state.
      next = launchIsAwaitingResult(current) ? 'failed' : current
      nextCause = undefined
      break
    }
    case 'downloading': {
      // The engine is fetching its model files: a busy throbber, not a
      // failure. The card re-polls (a re-launch) until the engine reports
      // ready, which settles the control to running.
      next = launchIsPhase(current) ? 'downloading' : current
      nextCause = undefined
      break
    }
    case 'stop': {
      // A stop moves a running engine (or an idle one running per the
      // summary, or a launch in flight, paused on a password or not) to
      // the stopping state; a stop already in flight is a no-op.
      next =
        current === 'running' ||
        current === 'stopping' ||
        current === 'idle' ||
        launchIsAwaitingResult(current)
          ? 'stopping'
          : current
      nextCause = undefined
      break
    }
    case 'stopped': {
      // The fast poll confirmed the provider is no longer running.
      next = current === 'stopping' ? 'idle' : current
      nextCause = undefined
      break
    }
    case 'stopFailed': {
      // The deadline fired while the provider was still running.
      next = current === 'stopping' ? 'failed' : current
      nextCause = current === 'stopping' ? 'stop' : cause
      break
    }
    case 'sudoNeeded': {
      // The host announced a password wait on the terminal that launched
      // the profile. Only an in-flight run can be waiting; a re-announce
      // from sudo re-enters the state and clears the cause, and a control
      // that cannot wait keeps its state and cause (the no-op pattern).
      const waitable = SUDO_WAITABLE_STATES.includes(current)
      next = waitable ? 'sudo' : current
      nextCause = waitable ? undefined : cause
      break
    }
    case 'reset': {
      // A launch failure reads as Launch (idle); a stop timeout reads as
      // Stop (running), because the engine is probably still up.
      next = current === 'failed' ? (cause === 'stop' ? 'running' : 'idle') : 'idle'
      nextCause = undefined
      break
    }
  }
  return { status: next, cause: nextCause }
}
