/**
 * The browser-side mirror of the core hf tqdm progress parser
 * (packages/core/src/progress.ts): the client bundle cannot import the
 * node-side core package, so the card keeps its own pure copy. parseHfProgress
 * folds the raw tqdm text the get route streams in its log events into a
 * GetProgressState, and deriveGetStep maps the step-header lines get-steps
 * emits to the current Get step, so the step chips and the progress readout
 * share one derivation.
 * @module dsh-plugin-local-infer/client/store/progress
 */
// The file-count bar: `Fetching 102 files: 42%|...| 43/102 [00:01<00:02, ...]`.
// The bar glyph run between the pipes is skipped, and the counts are plain
// integers.
const FILES_LINE = /^Fetching (\d+) files:\s*(\d+(?:\.\d+)?)%\|[^|]*\|\s*(\d+)\s*\/\s*(\d+)(?:\s*\[([^\]]*)\])?/;
// The byte bar: `Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, ...]`.
// The sizes carry an optional K/M/G/T/P unit (decimal, or binary with an
// `i`), and the tail is optional (a finished bar drops it).
const BYTES_LINE = /^(?:Downloading|Fetching)\s+([^:]+):\s*(\d+(?:\.\d+)?)%\s*\|\s*(\d+(?:\.\d+)?[KMGTP]?i?B?)\s*\/\s*(\d+(?:\.\d+)?[KMGTP]?i?B?)\s*(?:\[([^\]]*)\])?/;
// The unit exponents for the decimal (1000-based) sizes the hf CLI's tqdm
// renders; a binary `i` suffix (Gi, Mi, ...) switches the base to 1024.
const UNIT_EXPONENTS = { K: 1, M: 2, G: 3, T: 4, P: 5 };
// parseHumanSize converts one human byte size (`5.2G`) to bytes: the decimal
// base the hf CLI's tqdm uses, with a 1024 base when the unit carries the
// binary `i` suffix. A size with no unit is a plain byte count.
function parseHumanSize(text) {
    const match = /^(\d+(?:\.\d+)?)([KMGTP]?)i?B?$/.exec(text);
    if (match === null)
        return 0;
    const exponent = UNIT_EXPONENTS[match[2]] ?? 0;
    const base = text.includes('i') ? 1024 : 1000;
    return Number(match[1]) * base ** exponent;
}
// durationSeconds converts a `MM:SS`, `H:MM:SS`, or `D:H:MM:SS` clock string
// to seconds, the tqdm tail's remaining-time format.
function durationSeconds(text) {
    let seconds = 0;
    for (const part of text.split(':')) {
        seconds = seconds * 60 + Number(part);
    }
    return seconds;
}
// etaSecondsFromTail reads the remaining time out of a tqdm tail
// (`01:23<10:11, 72.3MB/s`): the clock string after the `<`, 0 when the tail
// is absent or carries no remaining time.
function etaSecondsFromTail(tail) {
    if (tail === undefined)
        return 0;
    const match = /<\s*(\d+(?::\d+)+)/.exec(tail);
    if (match === null)
        return 0;
    return durationSeconds(match[1]);
}
// parseHfProgressLine parses one tqdm bar line into a GetProgressState, or
// null when the line is not a bar update (a plain log line, a command echo,
// a bar half a chunk boundary split). It recognizes the file-count and byte
// shapes above.
function parseHfProgressLine(line) {
    const trimmed = line.trim();
    if (trimmed === '')
        return null;
    const files = FILES_LINE.exec(trimmed);
    if (files !== null) {
        // The file-count bar carries counts, not bytes: the done/total fields
        // hold the file numbers, the step label names the fetch, and the unit
        // marks the amounts as file counts, so a readout renders them as files.
        return {
            step: `Fetching ${files[1]} files`,
            percent: Number(files[2]),
            doneBytes: Number(files[3]),
            totalBytes: Number(files[4]),
            etaSeconds: etaSecondsFromTail(files[5]),
            unit: 'files',
        };
    }
    const bytes = BYTES_LINE.exec(trimmed);
    if (bytes !== null) {
        const verb = trimmed.startsWith('Fetching') ? 'Fetching' : 'Downloading';
        // The byte bar carries human byte sizes: the done/total fields hold the
        // parsed byte counts, and the unit marks the amounts as bytes.
        return {
            step: `${verb} ${bytes[1].trim()}`,
            percent: Number(bytes[2]),
            doneBytes: parseHumanSize(bytes[3]),
            totalBytes: parseHumanSize(bytes[4]),
            etaSeconds: etaSecondsFromTail(bytes[5]),
            unit: 'bytes',
        };
    }
    return null;
}
/**
 * parseHfProgress folds a streamed chunk into the latest GetProgressState it
 * carries: the chunk splits on the line separators tqdm writes (carriage
 * returns between bar redraws, newlines between steps), each line parses
 * through parseHfProgressLine, and the last parseable line wins. A chunk
 * with no bar update returns the prior state, so a caller threads the fold
 * across chunks and always holds the newest state.
 */
export function parseHfProgress(chunk, prior) {
    let folded = prior;
    for (const line of chunk.split(/\r\n|\r|\n/)) {
        const parsed = parseHfProgressLine(line);
        if (parsed !== null)
            folded = parsed;
    }
    return folded;
}
/**
 * deriveGetStep maps the step-header lines get-steps emits to the current
 * Get step: it scans the log text line by line, and the last recognized
 * header wins, so the step chips and the progress readout read one
 * derivation. It returns null when the log carries no header (a run that
 * has not reached a step yet).
 */
export function deriveGetStep(log) {
    let current = null;
    for (const line of log.split('\n')) {
        const step = stepForLine(line);
        if (step !== null)
            current = step;
    }
    return current;
}
// stepForLine maps one log line to the Get step its header names, or null
// for a line that is not a step header.
function stepForLine(line) {
    if (line.startsWith('system dependencies'))
        return 'deps';
    if (line.startsWith('model download:'))
        return 'model';
    if (line.startsWith('chat template:'))
        return 'template';
    if (line.trim() === 'get complete')
        return 'done';
    return null;
}
//# sourceMappingURL=progress.js.map
