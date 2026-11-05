/**
 * The provider list drivers: the edit, cancel, new, and delete actions the
 * provider list runs, plus the per-entry launch, stop, and Logs actions the
 * entry's lifecycle control runs.
 *
 * The list actions (edit, cancel, new, delete) move the provider form and the
 * draft through the store: a load stores a named draft without marking it
 * dirty (draft/load), and a delete rides the provider-delete route and stores
 * the fresh summary. The per-entry launch and stop drive the per-provider
 * launch machine through launch/move events, so the entry's control and the
 * title-bar control read the same lifecycle. The launch health-poll and sudo
 * deadlines and the stop fast-poll arm off the machine's timers, and each driver
 * returns a handle the panel owns: cancel clears the pending timers and marks
 * the run settled, so a late stream event or poll tick after an unmount never
 * moves the machine.
 * @module dsh-plugin-local-infer/client/store/providers
 */
import type { ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui';
import type { TextTable } from '../text.ts';
import { type CardStore } from './sync.ts';
/**
 * SUDO_DEADLINE_MS caps the card's wait after a launch stream announces a
 * sudo prompt: the host kills the process at 60 s (core's
 * SUDO_PASSWORD_TIMEOUT_MS) and this card-side deadline just past that cap
 * forces a hung password wait to the red Logs state, the same settle path as
 * the health-poll timeout. The client bundle cannot import the node-side
 * core package, so the number is mirrored here; the two change together by
 * hand.
 */
export declare const SUDO_DEADLINE_MS = 65000;
/**
 * EntryTimerHandle is the panel's ownership of a per-entry timer: cancel
 * clears the pending poll and deadline timers and marks the run settled, so
 * a late stream event or poll tick after the panel unmounts never moves the
 * machine. A no-op handle (a launch the guard rejected) cancels to nothing.
 */
export interface EntryTimerHandle {
    cancel(): void;
}
/**
 * editProvider loads a stored provider's engine, config, and platform into
 * the form (the next Save updates that entry in place). It caches the form's
 * current values first (a later "New provider" restores them), opens the form
 * in editing mode, and re-prices the meter and deps panel for the loaded
 * provider's engine.
 */
export declare function editProvider(store: CardStore, provider: ProviderSummaryEntry): void;
/**
 * cancelProvider collapses the editing form back to the provider entry list
 * and discards the staged edit: the draft reverts to the summary's stored
 * values, so nothing the user typed in the edit is kept. With no stored
 * entries the form reads as new-provider mode. The Cancel is also the
 * in-flight run's abort: it closes the in-flight Get run's stream and the
 * named provider's in-flight Launch run (the route's response close
 * interrupts the in-flight hf child on the host), and appends the "Canceled"
 * line to the Logs buffer, so the run reads as canceled in the textarea and
 * the log file.
 */
export declare function cancelProvider(store: CardStore, providerId?: string): void;
/**
 * newProvider resets the form to a fresh provider (the next Save mints an id
 * and prepends it). It restores the cached in-progress values (the form state
 * before the last edit); with no cache a fresh provider starts from the
 * current engine and a blank config.
 */
export declare function newProvider(store: CardStore): void;
/**
 * deleteProvider removes a saved provider entry through the provider-delete
 * route and stores the fresh summary. A delete in flight for another entry is
 * a no-op (a second click does not fire a second request). If the form was
 * editing the deleted entry, it stops editing it and collapses back to the
 * entry list (the new-provider form when the delete leaves no entries).
 */
export declare function deleteProvider(store: CardStore, providerId: string): Promise<void>;
/**
 * openEntryLogs opens the entry's red Logs control: it loads the entry for
 * editing AND resets the launch machine, so the per-entry control reads as
 * Launch again and the user fixes the config and re-launches from the same
 * entry.
 */
export declare function openEntryLogs(store: CardStore, provider: ProviderSummaryEntry): void;
/**
 * performEntryLaunch runs one card entry's own Launch control: it starts the
 * entry's launch machine at the prereqs phase, seeds the Logs buffer with a
 * "Launching..." separator, and reads the launch stream (a step event as each
 * phase begins, then a final result event). Each step event advances the
 * phase label; the build step writes a "Building..." separator; the launch
 * step arms the health-poll deadline (the route's poll runs up to two
 * minutes, so a client-side deadline just past that cap forces a hung launch
 * to the red Logs state); a sudo event moves the machine to sudo, appends the
 * CLI-note line, and arms the shorter sudo deadline through the same settle
 * path. A healthy result settles to running (the control
 * becomes Stop), a downloading result settles to downloading (a busy
 * throbber the card re-polls), and a failed result, a stream that ends
 * without a result, or a fetch failure settles to failed (the control becomes
 * a red Logs). A result re-fetches the summary and deps read models, so the
 * provider's status dot repaints from red to green and the deps panel
 * re-prices.
 */
export declare function performEntryLaunch(store: CardStore, provider: ProviderSummaryEntry, t: TextTable): EntryTimerHandle;
/**
 * performEntryStop runs one card entry's own Stop control: it moves the
 * entry's launch machine to stopping (the control shows the throbber,
 * disabled) and, for the duration of the stop, re-fetches the summary on a
 * fast cadence so the provider's status dot repaints the moment the engine
 * is down. A provider still running when the 10-second deadline fires settles
 * to the red Logs state (the same path a failed launch takes). A stop that
 * fails leaves the entry in its last state; the fast-poll and the deadline
 * settle it.
 */
export declare function performEntryStop(store: CardStore, provider: ProviderSummaryEntry): EntryTimerHandle;
/**
 * performDraftLaunch runs the form's own Launch control (the title-bar
 * control's draft target): it reads the launch stream (keeping only the result
 * event, the form's control shows no phase labels) and settles the draft's
 * launch cell. A sudo event sets the ui.sudoPending flag the control renders
 * "Sudo needed" from (the draft has no machine entry to read) and the flag
 * clears when the run settles. A healthy result reads as running (the control
 * becomes Stop), a not-healthy or missing result reads as the launch-failed
 * note. The summary and deps read models re-fetch so the provider's status
 * dot repaints and the deps panel re-prices. The run registers
 * its AbortController under the form's provider id (the "draft" key when the
 * form is not a provider), so the provider form's Cancel closes the stream
 * and the route interrupts the in-flight Get-step hf child on the host.
 */
export declare function performDraftLaunch(store: CardStore, t: TextTable): Promise<void>;
/**
 * performDraftStop runs the form's own Stop control (the title-bar control's
 * draft target): it signals the tracked process through the stop route and
 * settles the draft's stop cell. A successful stop reads as stopped (the
 * control becomes Launch). The summary and deps read models re-fetch so the
 * provider's status dot repaints and the deps panel re-prices.
 */
export declare function performDraftStop(store: CardStore, t: TextTable): Promise<void>;
//# sourceMappingURL=providers.d.ts.map
