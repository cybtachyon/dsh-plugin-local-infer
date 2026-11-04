/**
 * The shared Logs buffer helpers the provider and deps store modules both
 * write through: the run separator seed, the line append, the raw streamed
 * chunk append, and the "Canceled" line the abort paths write.
 *
 * The helpers live in a leaf module so deps.ts and providers.ts import them
 * from one place without an import edge between the two modules.
 * @module dsh-plugin-local-infer/client/store/logs
 */
// SEPARATOR_PREFIX is the run separator the Logs buffer writes before each
// run section (the "Launching...", "Building...", "Canceled" lines).
const SEPARATOR_PREFIX = '--- ';
// joinLine joins a new line to the Logs buffer, adding the newline only when
// the buffer is non-empty, so the buffer never opens with a blank line.
function joinLine(base, line) {
    return base + (base === '' ? '' : '\n') + line;
}
// separatorLine formats a run separator line (the "Launching...", "Building...",
// "Canceled" lines the Logs buffer writes between run sections).
export function separatorLine(label) {
    return SEPARATOR_PREFIX + label + '\n';
}
// seedProcessLog writes a "Launching..." separator to the Logs buffer, so the
// run reads as a fresh Logs section the launch appends to.
export function seedProcessLog(store, label) {
    const state = store.getSnapshot();
    const base = state.ui.logs.getLogs ?? state.summary?.lastLogs ?? '';
    store.dispatch({
        type: 'ui/patch',
        patch: {
            logs: {
                ...state.ui.logs,
                getLogs: joinLine(base, separatorLine(label)),
            },
        },
    });
}
// appendProcessLog appends a line to the Logs buffer (the build separator),
// keeping the existing buffer.
export function appendProcessLog(store, line) {
    const logs = store.getSnapshot().ui.logs;
    store.dispatch({
        type: 'ui/patch',
        patch: { logs: { ...logs, getLogs: joinLine(logs.getLogs ?? '', line) } },
    });
}
// appendLogChunk appends a raw streamed chunk to the Logs buffer without the
// newline join: the Get stream's chunks are complete lines the server framed,
// so they concatenate directly.
export function appendLogChunk(store, chunk) {
    const logs = store.getSnapshot().ui.logs;
    store.dispatch({
        type: 'ui/patch',
        patch: { logs: { ...logs, getLogs: (logs.getLogs ?? '') + chunk } },
    });
}
// appendCanceledLog appends the "Canceled" line to the Logs buffer when a
// cancel (the provider form's Cancel, the Get cancel) aborts an in-flight
// run, so the textarea reads the run as canceled the moment the cancel is
// clicked, the same line the route persists to the log file.
export function appendCanceledLog(store) {
    appendProcessLog(store, separatorLine('Canceled'));
}
//# sourceMappingURL=logs.js.map
