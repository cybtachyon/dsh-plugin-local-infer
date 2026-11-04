/**
 * The shared Logs buffer helpers the provider and deps store modules both
 * write through: the run separator seed, the line append, and the "Canceled"
 * line the abort paths write.
 *
 * The helpers live in a leaf module so deps.ts and providers.ts import them
 * from one place without an import edge between the two modules.
 * @module dsh-plugin-local-infer/client/store/logs
 */

import type { CardStore } from './sync.ts'

// seedProcessLog writes a "Launching..." separator to the Logs buffer, so the
// run reads as a fresh Logs section the launch appends to.
export function seedProcessLog(store: CardStore, label: string): void {
  const state = store.getSnapshot()
  const base = state.ui.logs.getLogs ?? state.summary?.lastLogs ?? ''
  store.dispatch({
    type: 'ui/patch',
    patch: {
      logs: {
        ...state.ui.logs,
        getLogs: base + (base === '' ? '' : '\n') + '--- ' + label + '\n',
      },
    },
  })
}

// appendProcessLog appends a line to the Logs buffer (the build separator),
// keeping the existing buffer.
export function appendProcessLog(store: CardStore, line: string): void {
  const logs = store.getSnapshot().ui.logs
  const base = logs.getLogs ?? ''
  store.dispatch({
    type: 'ui/patch',
    patch: { logs: { ...logs, getLogs: base + (base === '' ? '' : '\n') + line } },
  })
}

// appendCanceledLog appends the "Canceled" line to the Logs buffer when a
// cancel (the provider form's Cancel, the Get cancel) aborts an in-flight
// run, so the textarea reads the run as canceled the moment the cancel is
// clicked, the same line the route persists to the log file.
export function appendCanceledLog(store: CardStore): void {
  appendProcessLog(store, '--- Canceled\n')
}
