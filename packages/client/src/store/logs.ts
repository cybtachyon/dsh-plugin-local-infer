/**
 * The shared Logs buffer helpers the provider and deps store modules both
 * write through: the line append, the raw streamed chunk append, the
 * whole-buffer replace, and the "Canceled" line the abort paths write. The
 * run's own seed separator is the host's (beginRun seeds the hub, whose
 * runBegin/snapshot replaces the buffer), so no client seed helper remains.
 *
 * The helpers live in a leaf module so deps.ts and providers.ts import them
 * from one place without an import edge between the two modules.
 * @module dsh-plugin-local-infer/client/store/logs
 */

import type { CardStore } from './sync.ts'

// SEPARATOR_PREFIX is the run separator the Logs buffer writes before each
// run section (the "Launching...", "Building...", "Canceled" lines).
const SEPARATOR_PREFIX = '--- '

/**
 * SUDO_NOTE_LINE is the client's copy of the host's core SUDO_CLI_NOTE (the
 * client bundle cannot import the node-side core package, so the two copies
 * change together by hand). The launch stream's sudo event appends it to the
 * Logs buffer, the same line the host persists to the log file, so the
 * textarea tells the user where to type the password.
 */
export const SUDO_NOTE_LINE = 'Check your CLI for a sudo prompt'

// joinLine joins a new line to the Logs buffer, adding the newline only when
// the buffer is non-empty, so the buffer never opens with a blank line.
function joinLine(base: string, line: string): string {
  return base + (base === '' ? '' : '\n') + line
}

// separatorLine formats a run separator line (the "Launching...", "Building...",
// "Canceled" lines the Logs buffer writes between run sections).
export function separatorLine(label: string): string {
  return SEPARATOR_PREFIX + label + '\n'
}

// seedProcessLog removed with TASK-005: the host's beginRun seeds the run
// (the "Launching...", "Getting engine and model..." separators) and the
// run-log stream delivers that seed as runBegin/snapshot, so a client-side
// seed would land the line twice.

// appendProcessLog appends a line to the Logs buffer (the build separator,
// the sudo note), keeping the existing buffer.
export function appendProcessLog(store: CardStore, line: string): void {
  const logs = store.getSnapshot().ui.logs
  store.dispatch({
    type: 'ui/patch',
    patch: { logs: { ...logs, liveLogs: joinLine(logs.liveLogs ?? '', line) } },
  })
}

// appendLogChunk appends a raw streamed chunk to the Logs buffer without the
// newline join: the run-log stream's chunks are complete lines the server
// framed, so they concatenate directly.
export function appendLogChunk(store: CardStore, chunk: string): void {
  const logs = store.getSnapshot().ui.logs
  store.dispatch({
    type: 'ui/patch',
    patch: { logs: { ...logs, liveLogs: (logs.liveLogs ?? '') + chunk } },
  })
}

// replaceLogBuffer overwrites the Logs buffer with the host's own text (the
// run-log stream's snapshot and runBegin catch-up), keeping the pane's
// height and scroll mode through the merge-patch.
export function replaceLogBuffer(store: CardStore, text: string): void {
  const logs = store.getSnapshot().ui.logs
  store.dispatch({
    type: 'ui/patch',
    patch: { logs: { ...logs, liveLogs: text } },
  })
}

// appendCanceledLog appends the "Canceled" line to the Logs buffer when a
// cancel (the provider form's Cancel, the Get cancel) aborts an in-flight
// run, so the textarea reads the run as canceled the moment the cancel is
// clicked, the same line the route persists to the log file.
export function appendCanceledLog(store: CardStore): void {
  appendProcessLog(store, separatorLine('Canceled'))
}
