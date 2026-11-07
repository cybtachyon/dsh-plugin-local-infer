/**
 * The Logs section: the last run's captured output in a read-only textarea,
 * the log-file location the launch writes to, the diagonal chevron drag
 * handle that resizes the textarea, the five Get step chips (deps /
 * clone / build / model / template) that head the pane while a provider
 * process run is live, and the compact Cancel pill (the performGetCancel
 * driver) that heads the pane beside the chips over the same live state.
 *
 * The pane state lives in the store (ui.logs: the live run-log buffer, the
 * chevron-resized height, and the auto-scroll mode), so the section keeps no
 * pane state of its own. The displayed text is the deriveDisplayedLogs
 * projection (the live buffer while one is in place, else the summary's
 * lastLogs), and the auto-scroll effect pins the view to the bottom while the
 * mode is fresh or scrolling; a manual scroll up parks the mode at manual, so
 * content updates leave the view where the user put it. The chevron drag
 * clamps the height to the 96-480 px readable range. The pane's mount
 * registers the live run-log stream with the store module: mounted, the pane
 * target's stream attaches for the catch-up read; unmounted, it detaches.
 * @module dsh-plugin-local-infer/client/render/LogsPanel
 */
import type { ReactNode } from 'react';
import type { TextTable } from '../text.ts';
import type { CardStore } from '../store/sync.ts';
export interface LogsPanelProps {
    store: CardStore;
    t: TextTable;
}
/**
 * LogsPanel renders the Logs section from the store: the read-only textarea
 * (the live run-log buffer while one is in place, else the summary's
 * lastLogs), the auto-scroll (the view pins to the bottom while the mode is
 * fresh or scrolling; a scroll up parks it at manual), the chevron resize
 * drag (clamped to 96-480 px), the log-location field (a ui preference the
 * save route persists, not a synced value), and the five Get step chips
 * (the running step toned info and shimmered, the completed steps success,
 * the not-started steps quiet, and the failed step danger) that head the
 * pane while a provider process run is live.
 */
export declare function LogsPanel(props: LogsPanelProps): ReactNode;
//# sourceMappingURL=LogsPanel.d.ts.map
