/**
 * The Logs section: the last run's captured output in a read-only textarea,
 * the log-file location the launch writes to, the diagonal chevron drag
 * handle that resizes the textarea, and the five Get step chips (deps /
 * clone / build / model / template) that head the pane while a Get run is in
 * flight.
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
import { INPUT_STYLE, LABEL_STYLE, ROW_STYLE } from "../styles.js";
import { deriveDisplayedLogs, isGettingInFlight } from "../store/derive.js";
import { deriveGetStepTones } from "../store/progress.js";
import { getPrimitivesModule, renderTag, renderTextShimmer } from "./primitives.js";
import { react } from "./react.js";
// The readable height range the chevron drag clamps to, in px.
const LOGS_MIN_HEIGHT = 96;
const LOGS_MAX_HEIGHT = 480;
// The scroll-to-bottom tolerance in px: it absorbs sub-pixel rounding at the
// end of the scroll range, so the view reads as at the bottom.
const LOGS_BOTTOM_TOLERANCE = 4;
// The step chip row: the five Get step chips (deps / clone / build / model /
// template) that sit above the textarea while a Get run is in flight, wrapping
// to a second line on a narrow card.
const STEP_CHIPS_ROW_STYLE = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginBottom: 2,
};
/**
 * LogsPanel renders the Logs section from the store: the read-only textarea
 * (the streamed Get buffer while a run is in flight, else the summary's
 * lastLogs), the auto-scroll (the view pins to the bottom while the mode is
 * fresh or scrolling; a scroll up parks it at manual), the chevron resize
 * drag (clamped to 96-480 px), the log-location field (a ui preference the
 * save route persists, not a synced value), and the five Get step chips
 * (the running step toned info and shimmered, the completed steps success,
 * the not-started steps quiet, and the failed step danger) that head the
 * pane while a Get run is in flight.
 */
export function LogsPanel(props) {
    const { store, t } = props;
    const state = store.getSnapshot();
    const logs = state.ui.logs;
    const displayedLogs = deriveDisplayedLogs(state);
    const textareaRef = react.useRef(null);
    const dragRef = react.useRef(null);
    // The step chips render only while a Get run is in flight (the streamed
    // buffer is active and the get cell or the in-flight registry reads in
    // flight, the TASK-010 detection), or while the run has just settled
    // failed (the buffer is still active, so the failed step reads as danger).
    // With no run in flight the header shows nothing.
    const getFailed = state.actions.get.status === 'error';
    const chipsVisible = state.ui.logs.getLogs !== null && (isGettingInFlight(state) || getFailed);
    const stepTones = chipsVisible
        ? deriveGetStepTones(displayedLogs, getFailed)
        : null;
    const stepLabels = [t.stepDeps, t.stepClone, t.stepBuild, t.stepModel, t.stepTemplate];
    // patchLogs merges a partial LogsPaneState patch into the store's live
    // logs object, so a concurrent edit (a drag while content updates) never
    // clobbers a field the patch does not name.
    const patchLogs = (patch) => {
        const current = store.getSnapshot().ui.logs;
        store.dispatch({ type: 'ui/patch', patch: { logs: { ...current, ...patch } } });
    };
    // The auto-scroll: while the mode is fresh (the pane just opened) or
    // scrolling, a content update pins the view to the bottom. The first render
    // scrolls and arms scrolling; a manual scroll up parks the mode at manual,
    // so later updates leave the view where the user put it.
    react.useEffect(() => {
        const el = textareaRef.current;
        if (el === null) {
            return;
        }
        const mode = store.getSnapshot().ui.logs.scrollMode;
        if (mode === 'fresh' || mode === 'scrolling') {
            el.scrollTop = el.scrollHeight;
            if (mode === 'fresh') {
                patchLogs({ scrollMode: 'scrolling' });
            }
        }
    }, [displayedLogs, logs.scrollMode]);
    // The scroll handler: a scroll to the very bottom re-arms auto-scroll
    // (scrolling); any other position parks the mode at manual, so content
    // updates stop moving the view.
    const onLogsScroll = () => {
        const el = textareaRef.current;
        if (el === null) {
            return;
        }
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - LOGS_BOTTOM_TOLERANCE;
        patchLogs({ scrollMode: atBottom ? 'scrolling' : 'manual' });
    };
    // The resize handle: a pointerdown on the chevron starts a vertical drag.
    // A move computes the new height from the stable starting base (drag up
    // shrinks the section toward the default height, drag down expands it),
    // clamped to the readable range. The window listeners read the drag base
    // from the ref, so a re-render mid-drag never resets it.
    const onLogsResizeStart = (event) => {
        event.preventDefault();
        dragRef.current = { startClientY: event.clientY, startHeight: logs.height };
        const onMove = (moveEvent) => {
            const drag = dragRef.current;
            if (drag === null) {
                return;
            }
            moveEvent.preventDefault();
            // Drag down (clientY grows) expands, drag up shrinks, so the delta is
            // the pointer's downward travel.
            const delta = moveEvent.clientY - drag.startClientY;
            patchLogs({
                height: Math.max(LOGS_MIN_HEIGHT, Math.min(LOGS_MAX_HEIGHT, drag.startHeight + delta)),
            });
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    // The diagonal resize chevron: a DSH primitives down chevron rotated -45
    // degrees points into the bottom-right corner and reads as a resize handle.
    // A host without the seed keeps the native corner glyph.
    const chevron = getPrimitivesModule()?.IconChevronDownOutlineRegular;
    const chevronGlyph = typeof chevron === 'function' ? (react.createElement("span", { style: { display: 'inline-flex', transform: 'rotate(-45deg)' } }, react.createElement(chevron, { size: 12 }))) : ('\u231F');
    return (react.createElement("div", { style: { marginTop: 8 } },
        react.createElement("div", { style: LABEL_STYLE }, t.logs),
        stepTones !== null ? (react.createElement("div", { style: STEP_CHIPS_ROW_STYLE }, stepTones.map((tone, index) => (react.createElement("span", { key: index }, renderTag(tone, tone === 'info' ? renderTextShimmer(stepLabels[index]) : stepLabels[index])))))) : null,
        react.createElement("div", { style: { position: 'relative' } },
            react.createElement("textarea", { ref: textareaRef, style: {
                    width: '100%',
                    height: logs.height,
                    boxSizing: 'border-box',
                    resize: 'none',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    padding: 6,
                    border: '1px solid rgba(127,127,127,0.25)',
                    borderRadius: 6,
                    color: 'inherit',
                    background: 'transparent',
                }, value: displayedLogs, readOnly: true, onScroll: onLogsScroll, "aria-label": t.logs }),
            react.createElement("div", { style: {
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-end',
                    cursor: 'ns-resize',
                    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    userSelect: 'none',
                    touchAction: 'none',
                }, onPointerDown: onLogsResizeStart, role: "button", "aria-label": t.logs + ' ' + t.resize }, chevronGlyph)),
        react.createElement("div", { style: ROW_STYLE },
            react.createElement("label", { style: LABEL_STYLE }, t.logLocation),
            react.createElement("input", { style: INPUT_STYLE, value: state.ui.logPath, onChange: (event) => {
                    store.dispatch({ type: 'ui/patch', patch: { logPath: event.target.value } });
                } }))));
}
//# sourceMappingURL=LogsPanel.js.map
