/**
 * The Logs section: the last run's captured output in a read-only textarea,
 * the log-file location the launch writes to, and the diagonal chevron drag
 * handle that resizes the textarea.
 *
 * The pane state lives in the store (ui.logs: the streamed Get buffer, the
 * chevron-resized height, and the auto-scroll mode), so the section keeps no
 * pane state of its own. The displayed text is the deriveDisplayedLogs
 * projection (the streamed buffer while a run is in flight, else the
 * summary's lastLogs), and the auto-scroll effect pins the view to the bottom
 * while the mode is fresh or scrolling; a manual scroll up parks the mode at
 * manual, so content updates leave the view where the user put it. The
 * chevron drag clamps the height to the 96-480 px readable range.
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
 * (the streamed Get buffer while a run is in flight, else the summary's
 * lastLogs), the auto-scroll (the view pins to the bottom while the mode is
 * fresh or scrolling; a scroll up parks it at manual), the chevron resize
 * drag (clamped to 96-480 px), and the log-location field (a ui preference
 * the save route persists, not a synced value).
 */
export declare function LogsPanel(props: LogsPanelProps): ReactNode;
//# sourceMappingURL=LogsPanel.d.ts.map
