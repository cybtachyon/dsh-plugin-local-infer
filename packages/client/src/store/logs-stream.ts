/**
 * The live run-log stream: the store module that holds the card's single
 * attached GET /local-infer/logs connection (Q2: all live log display
 * streams, nothing polls). attachRunLogStream opens the connection for one
 * run key and feeds the Logs buffer: the catch-up snapshot replaces it, a
 * runBegin replaces it with the new run's seed, a log appends, and a runEnd
 * ends the key's in-flight marker. The pane follows one target at a time
 * (Q3: the edited provider, else the latest started run), so beginRun,
 * endRun, setLogsPaneMounted, and retargetRunLogs all route the single
 * attach through attachRunLogStream: a target switch detaches the old key
 * before the new one attaches. A stream that breaks while the client still
 * believes a run is in flight reconnects once after the backoff (the fresh
 * snapshot catch-up covers the gap); a break after the run settled ends
 * quietly with the buffer kept. A mount-time attach whose snapshot answers
 * running=false while nothing runs locally (the page-refresh catch-up read)
 * detaches right away and remembers the probe, so a re-render does not
 * re-open an idle key until a run starts there. The in-flight keys and the
 * followed-key marker ride the run-markers leaf (abort.ts's registry pattern)
 * so cardReducer and derive.ts read the live state without an import edge
 * here. clientRunLogKey mirrors the host's runLogKey rule so the client
 * names the buffer its own request writes.
 * @module dsh-plugin-local-infer/client/store/logs-stream
 */

import type { Config } from 'dsh-plugin-local-infer/ui'
import { subscribeRunLogs, type RunLogsEvent } from '../api/routes.ts'
import { appendLogChunk, replaceLogBuffer } from './logs.ts'
import {
  clearRunInFlight,
  clearRunMarkers,
  clearStreamFollowed,
  isRunInFlight,
  markRunInFlight,
  markStreamFollowed,
} from './run-markers.ts'
import type { CardStore } from './sync.ts'

/**
 * RECONNECT_BACKOFF_MS is the wait before a broken stream's single retry: a
 * host mid-restart answers the retry instead of a hammer, and the retry's
 * snapshot catch-up covers whatever the gap missed.
 */
export const RECONNECT_BACKOFF_MS = 1_000

/**
 * RunLogStreamHandle is one attach's ownership token: detach closes the
 * stream (the abort ends the in-flight body read), and a repeated detach is
 * a no-op.
 */
export interface RunLogStreamHandle {
  detach(): void
}

/**
 * RunLogKeyEntry is the stored provider shape the run-log key rule matches:
 * the entry id (the key itself when a request names it), the engine, and the
 * config whose model field pairs with the engine. The summary's provider
 * entries satisfy it structurally.
 */
export interface RunLogKeyEntry {
  id: string
  engine: string
  config: Config
}

/**
 * clientRunLogKey names the run-log key a request's output lands under,
 * mirroring the host's runLogKey rule (packages/service/src/run-logs.ts)
 * exactly: the request's providerId when it names one, else the stored entry
 * matched by engine and config model, else the engine id. Both sides read
 * the same request fields, so an unsaved model edit falls to the engine-id
 * key on both sides alike.
 */
export function clientRunLogKey(
  providers: readonly RunLogKeyEntry[],
  engine: string,
  config: Config,
  providerId?: string,
): string {
  if (providerId !== undefined && providerId.trim() !== '') {
    return providerId
  }
  const model = typeof config.model === 'string' ? config.model : undefined
  if (model === undefined) {
    return engine
  }
  const match = providers.find(
    (entry) =>
      entry.engine === engine &&
      (typeof entry.config.model === 'string' ? entry.config.model : undefined) === model,
  )
  return match !== undefined ? match.id : engine
}

// One attached stream: the key it serves, the abort that owns its fetch, and
// the flags that judge a break. hostRunning tracks the last snapshot or run
// event seen, settled marks the run over (a runEnd, or an end pass that
// spent the retry), and reconnected carries the single retry's use.
interface Attachment {
  key: string
  controller: AbortController
  detached: boolean
  settled: boolean
  hostRunning: boolean
  reconnected: boolean
}

// The module's single attach and its run bookkeeping. Module-level (the way
// abort.ts tracks in-flight runs): the card mounts one pane and one driver
// set, and clearRunLogStreams resets the slate for tests. The in-flight run
// keys and the followed-key marker themselves live in the run-markers leaf,
// which cardReducer and derive.ts read without an import edge here.
let active: Attachment | null = null
let logsPaneMounted = false
let lastRunKey: string | null = null
let catchUpTriedFor: string | null = null

/**
 * attachRunLogStream opens the card's one run-log stream for key: an attach
 * already serving the same key is reused (the single-attach invariant), and
 * an attach on another key is detached first. The handle's detach ends the
 * stream and drops every later event on it.
 */
export function attachRunLogStream(store: CardStore, key: string): RunLogStreamHandle {
  if (active !== null && active.key === key) {
    return handleFor(active)
  }
  detachActive()
  const attachment: Attachment = {
    key,
    controller: new AbortController(),
    detached: false,
    settled: false,
    hostRunning: false,
    reconnected: false,
  }
  active = attachment
  markStreamFollowed(key)
  openStream(store, attachment)
  return handleFor(attachment)
}

/**
 * beginRun records a driver-started run under key and makes it the pane
 * target (Q3: the latest started run). With the Logs section mounted the
 * stream attaches right away: the snapshot may momentarily show the prior
 * run's text (the driver's request can beat the host's hub begin), and the
 * host's runBegin event replaces it with the new run's seed.
 */
export function beginRun(store: CardStore, key: string): void {
  markRunInFlight(key)
  lastRunKey = key
  if (catchUpTriedFor === key) {
    catchUpTriedFor = null
  }
  if (logsPaneMounted) {
    attachRunLogStream(store, key)
  }
}

/**
 * endRun drops key's in-flight marker when its driver settles and closes a
 * stream still following the run. The pane falls back to the edited
 * provider target (Q3), so endRun only switches to that provider when the
 * form is editing one; otherwise it detaches, and the summary ack hands the
 * pane back to the stored lastLogs.
 */
export function endRun(store: CardStore, key: string): void {
  clearRunInFlight(key)
  if (lastRunKey === key) {
    lastRunKey = null
  }
  if (active === null || active.key !== key) {
    return
  }
  const editing = store.getSnapshot().ui.editingProviderId
  if (logsPaneMounted && editing !== null && editing !== key) {
    attachRunLogStream(store, editing)
    return
  }
  detachActive()
}

/**
 * setLogsPaneMounted records the Logs section's mount from the pane's own
 * effect. Mounting retargets the stream (the page-refresh catch-up: the pane
 * target attaches, and a snapshot answering running=false closes an idle
 * probe right away); unmounting detaches, so a collapsed form never holds
 * an open connection.
 */
export function setLogsPaneMounted(store: CardStore, mounted: boolean): void {
  if (logsPaneMounted === mounted) {
    return
  }
  logsPaneMounted = mounted
  if (!mounted) {
    detachActive()
    return
  }
  retargetRunLogs(store)
}

/**
 * retargetRunLogs syncs the single attached stream to the pane target (Q3):
 * the edited provider, else the latest locally started run. The card runs it
 * on an editing switch and on a summary ack (the read the page-refresh mount
 * guesses from); a null target detaches, and a target whose idle probe is
 * remembered detaches without re-opening it until a run starts there.
 */
export function retargetRunLogs(store: CardStore): void {
  if (!logsPaneMounted) {
    return
  }
  const target = paneTargetKey(store)
  if (target === null || catchUpTriedFor === target) {
    detachActive()
    return
  }
  if (active !== null && active.key === target) {
    return
  }
  attachRunLogStream(store, target)
}

// paneTargetKey resolves the Q3 target: the provider the form edits, else
// the latest locally started in-flight run, else (nothing local names a run,
// the page-refresh read) the provider the summary reports running, else the
// summary's engine key. A pane target names a stored provider by its id,
// which is the run-log key for every request that names it.
function paneTargetKey(store: CardStore): string | null {
  const state = store.getSnapshot()
  const editing = state.ui.editingProviderId
  if (editing !== null) {
    return editing
  }
  if (lastRunKey !== null && isRunInFlight(lastRunKey)) {
    return lastRunKey
  }
  const summary = state.summary
  if (summary === null) {
    return null
  }
  const running = (summary.providers ?? []).find((entry) => entry.status === 'running')
  if (running !== undefined) {
    return running.id
  }
  return typeof summary.engineId === 'string' && summary.engineId !== ''
    ? summary.engineId
    : null
}

/**
 * clearRunLogStreams detaches any attached stream and drops the module's run
 * bookkeeping, so a test starts from an empty slate (the module state
 * outlives a single test).
 */
export function clearRunLogStreams(): void {
  detachActive()
  clearRunMarkers()
  lastRunKey = null
  catchUpTriedFor = null
  logsPaneMounted = false
}

function handleFor(attachment: Attachment): RunLogStreamHandle {
  return {
    detach(): void {
      detachAttachment(attachment)
    },
  }
}

function detachAttachment(attachment: Attachment): void {
  if (attachment.detached) {
    return
  }
  attachment.detached = true
  attachment.controller.abort()
  clearStreamFollowed(attachment.key)
  if (active === attachment) {
    active = null
  }
}

function detachActive(): void {
  if (active !== null) {
    detachAttachment(active)
  }
}

// openStream reads one pass of the NDJSON answer. The promise settles when
// the stream ends, breaks, or the abort ends it; either way endPass judges
// the pass for the active attachment.
function openStream(store: CardStore, attachment: Attachment): void {
  subscribeRunLogs(
    attachment.key,
    (event) => streamEvent(store, attachment, event),
    attachment.controller.signal,
  )
    .then(() => endPass(store, attachment))
    .catch(() => endPass(store, attachment))
}

// streamEvent feeds the live buffer: the snapshot and a runBegin replace it
// (the host owns the run's whole text from its first line), a log appends,
// and a runEnd ends the key's in-flight marker so a later break reads as a
// quiet end. A snapshot answering running=false while no local run waits on
// the key is the catch-up read finding the key idle: detach right away and
// remember the probe.
function streamEvent(store: CardStore, attachment: Attachment, event: RunLogsEvent): void {
  if (attachment.detached || active !== attachment) {
    return
  }
  if (event.snapshot !== undefined) {
    attachment.hostRunning = event.running === true
    replaceLogBuffer(store, event.snapshot)
    if (!attachment.hostRunning && !isRunInFlight(attachment.key)) {
      catchUpTriedFor = attachment.key
      attachment.settled = true
      detachAttachment(attachment)
    }
    return
  }
  if (event.runBegin !== undefined) {
    attachment.hostRunning = true
    replaceLogBuffer(store, event.runBegin)
    return
  }
  if (event.log !== undefined) {
    appendLogChunk(store, event.log)
    return
  }
  if (event.runEnd !== undefined) {
    attachment.hostRunning = false
    attachment.settled = true
    clearRunInFlight(attachment.key)
    // The pane no longer follows a live run: the followed marker clears now
    // (the connection may still be open), so a summary ack after the runEnd
    // hands the buffer back to the summary's persisted lastLogs.
    clearStreamFollowed(attachment.key)
  }
}

// endPass closes a pass that ended while its attachment is still active. A
// break during a run the client still believes is in flight spends the
// single reconnect: the retry waits the backoff, and the fresh snapshot
// catch-up covers the gap. Anything else (a settled run, a spent retry) ends
// quietly, keeping the buffer and leaving no listener behind.
function endPass(store: CardStore, attachment: Attachment): void {
  if (attachment.detached || active !== attachment) {
    return
  }
  const runInFlightHere =
    !attachment.settled && (attachment.hostRunning || isRunInFlight(attachment.key))
  if (runInFlightHere && !attachment.reconnected) {
    attachment.reconnected = true
    setTimeout(() => {
      if (attachment.detached || active !== attachment) {
        return
      }
      openStream(store, attachment)
    }, RECONNECT_BACKOFF_MS)
    return
  }
  attachment.settled = true
  // The pass ended without a run to follow: the pane no longer holds a live
  // view, so the followed marker clears and a summary ack may hand the buffer
  // back to the stored lastLogs.
  clearStreamFollowed(attachment.key)
  active = null
}
