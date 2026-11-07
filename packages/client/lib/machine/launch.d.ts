/**
 * The per-entry provider launch state machine: the card's Launch/Stop
 * control lifecycle, ported 1:1 from the hand-written dsh/client.js.
 *
 * The states are the control's reads: idle (a plain Launch), the four
 * rebuild phases (prereqs, download, build, launch), downloading (a busy
 * throbber while the engine fetches model files, settled by the
 * summaryStatus fold the summary ack dispatches: a reported-running
 * provider settles to running, a reported-stopped one lands idle like the
 * stop rule's confirmed-down), sudo (the host is
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
 * downloading state ignores steps, and an unknown step name is a
 * no-op. A healthy result settles to running, a failed result settles to
 * failed, the summaryStatus event settles the downloading state from the
 * summary's provider status, a stop moves a running (or idle, a provider
 * running per the
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
import type { ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui';
/**
 * LAUNCH_PHASE_STATES is the card-side step-name tuple: the four rebuild
 * phases the launch step stream can carry, as the one machine-local source the
 * LaunchStep union derives from. The host side is core's LAUNCH_STEPS tuple
 * (the card bundle carries no core code); the ui suite pins the two tuples
 * equal so a name added on one side without the other fails a test, not the
 * button.
 */
export declare const LAUNCH_PHASE_STATES: readonly ["prereqs", "download", "build", "launch"];
/** The rebuild phase a launch step event names, derived from the tuple. */
export type LaunchStep = (typeof LAUNCH_PHASE_STATES)[number];
export declare const LAUNCH_HEALTH_DEADLINE_MS = 150000;
export declare const STOP_POLL_MS = 1000;
export declare const STOP_HEALTH_DEADLINE_MS = 10000;
/** The launch control's states, as the control reads them. */
export type LaunchStatus = 'idle' | LaunchStep | 'downloading' | 'sudo' | 'running' | 'stopping' | 'failed';
/** The cause a failed state carries: 'stop' marks a stop that timed out. */
export type LaunchCause = 'stop';
/** A provider's launch machine entry. */
export interface LaunchEntry {
    status: LaunchStatus;
    cause?: LaunchCause | undefined;
}
/** The events the machine consumes. */
export type LaunchEvent = {
    type: 'start';
} | {
    type: 'step';
    step: string;
} | {
    type: 'healthy';
} | {
    type: 'failed';
} | {
    type: 'downloading';
} | {
    type: 'summaryStatus';
    status: ProviderSummaryEntry['status'];
} | {
    type: 'sudoNeeded';
} | {
    type: 'stop';
} | {
    type: 'stopped';
} | {
    type: 'stopFailed';
} | {
    type: 'reset';
};
/**
 * LaunchInFlightStatus is the machine's set of in-flight control states:
 * the four rebuild phases, the model fetch (downloading), the sudo wait,
 * and a stop in flight. Each one shows a busy label on the control; idle,
 * running, and failed show none.
 */
export type LaunchInFlightStatus = LaunchStep | 'downloading' | 'sudo' | 'stopping';
/**
 * LaunchDisplayKey names a text.ts label key (not its copy) so the machine
 * can map a state to its label without holding any label text. The tables
 * stay the i18n source: every key here carries a label in both the en and
 * the zh table, and a key the tables drop is a compile error where the key
 * indexes the table.
 */
export type LaunchDisplayKey = 'entryPrereqs' | 'entryDownloading' | 'entryBuilding' | 'entrySudo' | 'entryLaunching' | 'stopping';
/**
 * LAUNCH_STATE_DISPLAY is the machine's displayText mapping: it names, in
 * one place, which label key each in-flight state shows on the control.
 * The machine names stay logical (download names the rebuild download
 * phase, downloading the model-fetch re-poll); both read the one download
 * label so the title bar mirrors the entry's Launch button while the
 * engine fetches files. Labels stay short and user-friendly in text.ts.
 */
export declare const LAUNCH_STATE_DISPLAY: Record<LaunchInFlightStatus, LaunchDisplayKey>;
/**
 * launchDisplayKeyFor names the label key an in-flight state displays, or
 * undefined for a state that shows no busy label (idle, running, failed).
 * phaseLabelFor (store/derive.ts) is its single consumer.
 */
export declare function launchDisplayKeyFor(status: LaunchStatus): LaunchDisplayKey | undefined;
/** launchIsPhase reports whether a state is one of the four rebuild phases. */
export declare function launchIsPhase(state: LaunchStatus): state is LaunchStep;
/**
 * launchNextState computes the machine's next entry from the current entry
 * and an event. A null or undefined entry prices as idle, so a provider
 * running per the summary with no machine entry can be stopped.
 */
export declare function launchNextState(entry: LaunchEntry | null | undefined, event: LaunchEvent): LaunchEntry;
//# sourceMappingURL=launch.d.ts.map
