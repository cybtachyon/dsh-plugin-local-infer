/**
 * The per-key live run-log hub: one bounded buffer per run key with fan-out
 * to subscribers, so every provider process (Get, Launch, Prereqs, Download,
 * Install, Stop) writes its output to one place the streaming web route
 * serves. The LocalInfer facade publishes the five operations (begin,
 * append, read, subscribe, end); runLogKey names the key rule every caller
 * shares.
 * @module dsh-plugin-local-infer/service/run-logs
 */
import { LOG_TAIL_BYTES } from '../../core/lib/index.js';
import { findLaunchTarget } from "./launch-target.js";
/**
 * RunLogStore holds one RunBuffer per run key and fans RunLogEvents out to
 * the key's subscribers. A throwing listener is isolated per notify, so a
 * broken stream connection never blocks a writer or another subscriber.
 */
export class RunLogStore {
    buffers = new Map();
    /**
     * begin resets the key's buffer to the seed line, restarts the seq at 0,
     * marks the run running, and notifies subscribers with the reset event so
     * a mid-run attached reader replaces its display instead of appending
     * onto the previous run.
     */
    begin(key, seed) {
        const buffer = this.bufferFor(key);
        buffer.text = seed;
        buffer.seq = 0;
        buffer.running = true;
        this.notify(buffer, { kind: 'reset', seq: 0, text: seed });
    }
    /**
     * append grows the key's text (tail-capped to LOG_TAIL_BYTES, the same
     * rule the stored last-run logs use), counts the append, and notifies
     * subscribers with the chunk. A key with no open run opens one lazily
     * without a seed, and an append to a settled run reopens it, so a note
     * that lands after the run (an engine-death line) still streams; the
     * caller that opens a run this way closes it with its own end.
     */
    append(key, chunk) {
        const buffer = this.bufferFor(key);
        buffer.text += chunk;
        if (buffer.text.length > LOG_TAIL_BYTES) {
            buffer.text = buffer.text.slice(-LOG_TAIL_BYTES);
        }
        buffer.running = true;
        buffer.seq += 1;
        this.notify(buffer, { kind: 'log', seq: buffer.seq, text: chunk });
    }
    /**
     * read answers the key's catch-up snapshot. A key that never ran reads as
     * an empty stopped snapshot.
     */
    read(key) {
        const buffer = this.buffers.get(key);
        if (buffer === undefined)
            return { seq: 0, text: '', running: false };
        return { seq: buffer.seq, text: buffer.text, running: buffer.running };
    }
    /**
     * subscribe registers a listener for the key's events and returns the
     * disposer. Registering the same function twice delivers once (Set
     * semantics); each connection registers its own closure.
     */
    subscribe(key, listener) {
        const buffer = this.bufferFor(key);
        buffer.listeners.add(listener);
        return () => {
            buffer.listeners.delete(listener);
        };
    }
    /**
     * end clears the running flag and emits the end event; the text stays
     * readable until the next begin. A key with no open run is a no-op, so a
     * repeated end never emits a second end event.
     */
    end(key) {
        const buffer = this.buffers.get(key);
        if (buffer === undefined || !buffer.running)
            return;
        buffer.running = false;
        this.notify(buffer, { kind: 'end', seq: buffer.seq });
    }
    /**
     * bufferFor reads the key's buffer, starting an empty stopped one for a
     * key that has none.
     */
    bufferFor(key) {
        let buffer = this.buffers.get(key);
        if (buffer === undefined) {
            buffer = { text: '', seq: 0, running: false, listeners: new Set() };
            this.buffers.set(key, buffer);
        }
        return buffer;
    }
    /**
     * notify hands one event to each listener of one buffer. It iterates a
     * copy so a disposer running inside a listener cannot disturb the pass,
     * and it swallows listener throws: a broken connection must never fail
     * the writer.
     */
    notify(buffer, event) {
        for (const listener of [...buffer.listeners]) {
            try {
                listener(event);
            }
            catch {
                // The connection is broken; its own route tears it down.
            }
        }
    }
}
/**
 * runLogKey names the run key every run path and the logs route share, so
 * the client can always predict the key for its request: the request's
 * providerId when it names one, else the stored entry findLaunchTarget
 * matches by engine and model, else the engine id.
 */
export function runLogKey(providers, engineId, providerId, config) {
    if (providerId !== undefined && providerId.trim() !== '')
        return providerId;
    const target = findLaunchTarget(providers, engineId, undefined, config);
    return target?.id ?? engineId;
}
//# sourceMappingURL=run-logs.js.map
