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
 * corrupts it. LAUNCH_STATE_DISPLAY is the machine's displayText mapping:
 * it names the text.ts label key each in-flight state shows, so the
 * state-to-label decision lives with the machine and the label copy lives
 * in the text tables.
 * @module dsh-plugin-local-infer/client/machine/launch
 */

/**
 * LAUNCH_PHASE_STATES is the card-side step-name tuple: the four rebuild
 * phases the launch step stream can carry, as the one machine-local source the
 * LaunchStep union derives from. The host side is core's LAUNCH_STEPS tuple
 * (the card bundle carries no core code); the ui suite pins the two tuples
 * equal so a name added on one side without the other fails a test, not the
 * button.
 */
export const LAUNCH_PHASE_STATES = ['prereqs', 'download', 'build', 'launch'] as const

/** The rebuild phase a launch step event names, derived from the tuple. */
export type LaunchStep = (typeof LAUNCH_PHASE_STATES)[number]

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

/**
 * LaunchInFlightStatus is the machine's set of in-flight control states:
 * the four rebuild phases, the model fetch (downloading), the sudo wait,
 * and a stop in flight. Each one shows a busy label on the control; idle,
 * running, and failed show none.
 */
export type LaunchInFlightStatus = LaunchStep | 'downloading' | 'sudo' | 'stopping'

/**
 * LaunchDisplayKey names a text.ts label key (not its copy) so the machine
 * can map a state to its label without holding any label text. The tables
 * stay the i18n source: every key here carries a label in both the en and
 * the zh table, and a key the tables drop is a compile error where the key
 * indexes the table.
 */
export type LaunchDisplayKey =
  | 'entryPrereqs'
  | 'entryDownloading'
  | 'entryBuilding'
  | 'entrySudo'
  | 'entryLaunching'
  | 'stopping'

/**
 * LAUNCH_STATE_DISPLAY is the machine's displayText mapping: it names, in
 * one place, which label key each in-flight state shows on the control.
 * The machine names stay logical (download names the rebuild download
 * phase, downloading the model-fetch re-poll); both read the one download
 * label so the title bar mirrors the entry's Launch button while the
 * engine fetches files. Labels stay short and user-friendly in text.ts.
 */
export const LAUNCH_STATE_DISPLAY: Record<
  LaunchInFlightStatus,
  LaunchDisplayKey
> = {
  prereqs: 'entryPrereqs',
  download: 'entryDownloading',
  downloading: 'entryDownloading',
  build: 'entryBuilding',
  launch: 'entryLaunching',
  sudo: 'entrySudo',
  stopping: 'stopping',
}

/**
 * launchDisplayKeyFor names the label key an in-flight state displays, or
 * undefined for a state that shows no busy label (idle, running, failed).
 * phaseLabelFor (store/derive.ts) is its single consumer.
 */
export function launchDisplayKeyFor(
  status: LaunchStatus,
): LaunchDisplayKey | undefined {
  const display: Partial<Record<LaunchStatus, LaunchDisplayKey>> =
    LAUNCH_STATE_DISPLAY
  return display[status]
}

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
