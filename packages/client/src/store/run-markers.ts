/**
 * The live-run marker registry: the module-level markers that say whether a
 * provider process is live from the card's side. Two kinds ride here: the
 * in-flight run keys every driver brackets (beginRun/endRun in
 * logs-stream.ts), and the one run-log key the Logs pane's attached stream
 * currently follows (attach/detach, and the key's runEnd, which ends what
 * the pane follows even while the connection stays open).
 *
 * The registry is a leaf with no imports so both sides reach it directly:
 * logs-stream.ts maintains the markers, cardReducer reads them (a summary
 * ack during a live run must not wipe the buffer the stream feeds), and
 * derive.ts projects them for the Logs pane's chips and Cancel pill, the way
 * derive.ts reads abort.ts's in-flight registry. clearRunMarkers resets the
 * slate for tests (the module state outlives a single test).
 * @module dsh-plugin-local-infer/client/store/run-markers
 */

// The driver-started runs in flight (the run-log keys beginRun marked and
// endRun or a streamed runEnd has not yet cleared).
const runKeys = new Set<string>()

// The run-log key the pane's attached stream follows, or null while nothing
// is followed (no attach, detached, or the followed run ended).
let followedKey: string | null = null

/** markRunInFlight records a driver-started run under key (beginRun). */
export function markRunInFlight(key: string): void {
  runKeys.add(key)
}

/**
 * clearRunInFlight drops key's in-flight marker (the driver's endRun, or the
 * stream's runEnd for that key).
 */
export function clearRunInFlight(key: string): void {
  runKeys.delete(key)
}

/** isRunInFlight reports whether key has a driver-started run in flight. */
export function isRunInFlight(key: string): boolean {
  return runKeys.has(key)
}

/** markStreamFollowed records the pane's stream now following key (attach). */
export function markStreamFollowed(key: string): void {
  followedKey = key
}

/**
 * clearStreamFollowed drops the followed marker when it names key (a
 * detach, the followed key's runEnd, or a pass that ended quietly). Another
 * key's marker survives: a key switch detaches the old attach after the new
 * one records itself.
 */
export function clearStreamFollowed(key: string): void {
  if (followedKey === key) {
    followedKey = null
  }
}

/** isStreamFollowed reports whether the pane follows one key's live stream. */
export function isStreamFollowed(): boolean {
  return followedKey !== null
}

/**
 * isLiveRunAttached reports whether a provider process is live from the
 * card's side: any driver-started run in flight, or the pane following a run
 * whose stream is still open. cardReducer's summaryAck keeps the live Logs
 * buffer while it is true, and the Logs pane renders its step chips and
 * Cancel pill from it (with the Get cell's own in-flight read).
 */
export function isLiveRunAttached(): boolean {
  return runKeys.size > 0 || followedKey !== null
}

/** clearRunMarkers drops every marker, so a test starts from an empty slate. */
export function clearRunMarkers(): void {
  runKeys.clear()
  followedKey = null
}
