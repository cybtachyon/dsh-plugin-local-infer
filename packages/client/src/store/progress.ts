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

import type { HfProgressShape } from '../api/routes.ts'

/**
 * GetProgressState is the structured download progress state the card folds
 * the streamed tqdm text into: the step label the bar names, the percent
 * complete, the done and total amounts (bytes for the byte bar, file counts
 * for the file-count bar), the remaining time in seconds (0 when the bar
 * carries no tail), and the unit the done/total amounts carry ('bytes' for
 * the byte bar, 'files' for the file-count bar), so a readout renders the
 * amounts in the unit the bar measured. It aliases HfProgressShape, the
 * shape the routes' progress events carry, so the log-text fold and the
 * structured events populate one state.
 */
export type GetProgressState = HfProgressShape

/** The Get step the step chips and the progress readout derive. */
export type GetStep = 'deps' | 'clone' | 'build' | 'model' | 'template' | 'done'

// The tone a step chip renders in: success (the step completed), info (the
// step is running), quiet (the step has not started), danger (the run
// settled failed at the step).
export type StepTone = 'success' | 'info' | 'quiet' | 'danger'

// The chip order the Logs header renders, matching the Get run's step
// sequence. deriveGetStep names the deps, clone, build, model, template, and
// done headers, so each chip tracks its own sub-step.
const GET_STEP_ORDER: GetStep[] = ['deps', 'clone', 'build', 'model', 'template']

// The running chip index each Get step maps to, in chip order. A step reads
// its own position as the running chip, so the clone and build headers track
// their own chips. done maps past the last chip, so every chip reads success.
const STEP_RUNNING_INDEX: Record<GetStep, number> = {
  deps: 0,
  clone: 1,
  build: 2,
  model: 3,
  template: 4,
  done: 5,
}

// The file-count bar: `Fetching 102 files: 42%|...| 43/102 [00:01<00:02, ...]`.
// The bar glyph run between the pipes is skipped, and the counts are plain
// integers.
const FILES_LINE =
  /^Fetching (\d+) files:\s*(\d+(?:\.\d+)?)%\|[^|]*\|\s*(\d+)\s*\/\s*(\d+)(?:\s*\[([^\]]*)\])?/

// The byte bar: `Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, ...]`.
// The sizes carry an optional K/M/G/T/P unit (decimal, or binary with an
// `i`), and the tail is optional (a finished bar drops it).
const BYTES_LINE =
  /^(?:Downloading|Fetching)\s+([^:]+):\s*(\d+(?:\.\d+)?)%\s*\|\s*(\d+(?:\.\d+)?[KMGTP]?i?B?)\s*\/\s*(\d+(?:\.\d+)?[KMGTP]?i?B?)\s*(?:\[([^\]]*)\])?/

// The unit exponents for the decimal (1000-based) sizes the hf CLI's tqdm
// renders; a binary `i` suffix (Gi, Mi, ...) switches the base to 1024.
const UNIT_EXPONENTS: Record<string, number> = { K: 1, M: 2, G: 3, T: 4, P: 5 }

// parseHumanSize converts one human byte size (`5.2G`) to bytes: the decimal
// base the hf CLI's tqdm uses, with a 1024 base when the unit carries the
// binary `i` suffix. A size with no unit is a plain byte count.
function parseHumanSize(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([KMGTP]?)i?B?$/.exec(text)
  if (match === null) return 0
  const exponent = UNIT_EXPONENTS[match[2]!] ?? 0
  const base = text.includes('i') ? 1024 : 1000
  return Number(match[1]!) * base ** exponent
}

// durationSeconds converts a `MM:SS`, `H:MM:SS`, or `D:H:MM:SS` clock string
// to seconds, the tqdm tail's remaining-time format.
function durationSeconds(text: string): number {
  let seconds = 0
  for (const part of text.split(':')) {
    seconds = seconds * 60 + Number(part)
  }
  return seconds
}

// etaSecondsFromTail reads the remaining time out of a tqdm tail
// (`01:23<10:11, 72.3MB/s`): the clock string after the `<`, 0 when the tail
// is absent or carries no remaining time.
function etaSecondsFromTail(tail: string | undefined): number {
  if (tail === undefined) return 0
  const match = /<\s*(\d+(?::\d+)+)/.exec(tail)
  if (match === null) return 0
  return durationSeconds(match[1]!)
}

// parseHfProgressLine parses one tqdm bar line into a GetProgressState, or
// null when the line is not a bar update (a plain log line, a command echo,
// a bar half a chunk boundary split). It recognizes the file-count and byte
// shapes above.
function parseHfProgressLine(line: string): GetProgressState | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const files = FILES_LINE.exec(trimmed)
  if (files !== null) {
    // The file-count bar carries counts, not bytes: the done/total fields
    // hold the file numbers, the step label names the fetch, and the unit
    // marks the amounts as file counts, so a readout renders them as files.
    return {
      step: `Fetching ${files[1]} files`,
      percent: Number(files[2]!),
      doneBytes: Number(files[3]!),
      totalBytes: Number(files[4]!),
      etaSeconds: etaSecondsFromTail(files[5]),
      unit: 'files',
    }
  }
  const bytes = BYTES_LINE.exec(trimmed)
  if (bytes !== null) {
    const verb = trimmed.startsWith('Fetching') ? 'Fetching' : 'Downloading'
    // The byte bar carries human byte sizes: the done/total fields hold the
    // parsed byte counts, and the unit marks the amounts as bytes.
    return {
      step: `${verb} ${bytes[1]!.trim()}`,
      percent: Number(bytes[2]!),
      doneBytes: parseHumanSize(bytes[3]!),
      totalBytes: parseHumanSize(bytes[4]!),
      etaSeconds: etaSecondsFromTail(bytes[5]),
      unit: 'bytes',
    }
  }
  return null
}

/**
 * parseHfProgress folds a streamed chunk into the latest GetProgressState it
 * carries: the chunk splits on the line separators tqdm writes (carriage
 * returns between bar redraws, newlines between steps), each line parses
 * through parseHfProgressLine, and the last parseable line wins. A chunk
 * with no bar update returns the prior state, so a caller threads the fold
 * across chunks and always holds the newest state.
 */
export function parseHfProgress(
  chunk: string,
  prior: GetProgressState | null,
): GetProgressState | null {
  let folded = prior
  for (const line of chunk.split(/\r\n|\r|\n/)) {
    const parsed = parseHfProgressLine(line)
    if (parsed !== null) folded = parsed
  }
  return folded
}

/**
 * deriveGetStep maps the step-header lines get-steps emits to the current
 * Get step: it scans the log text line by line, and the last recognized
 * header wins, so the step chips and the progress readout read one
 * derivation. It returns null when the log carries no header (a run that
 * has not reached a step yet).
 */
export function deriveGetStep(log: string): GetStep | null {
  let current: GetStep | null = null
  for (const line of log.split('\n')) {
    const step = stepForLine(line)
    if (step !== null) current = step
  }
  return current
}

/**
 * deriveGetStepTones maps the run's current step (deriveGetStep) and its
 * settled-failed flag to the five step chips' tones, in chip order. Steps
 * before the current one read as success; the current step reads as info (the
 * running chip) or danger when the run settled failed at it; steps after it
 * read as quiet. A null current step (no header seen) and the deps header
 * read as the first chip running.
 */
export function deriveGetStepTones(log: string, failed: boolean): StepTone[] {
  const current = deriveGetStep(log)
  const runningIndex = current === null ? 0 : STEP_RUNNING_INDEX[current]
  return GET_STEP_ORDER.map((_step, index) => {
    if (index < runningIndex) return 'success'
    if (index === runningIndex) return failed ? 'danger' : 'info'
    return 'quiet'
  })
}

// stepForLine maps one log line to the Get step its header names, or null
// for a line that is not a step header.
function stepForLine(line: string): GetStep | null {
  if (line.startsWith('system dependencies')) return 'deps'
  if (line.startsWith('engine clone:')) return 'clone'
  if (line.startsWith('engine build:')) return 'build'
  if (line.startsWith('model download:')) return 'model'
  if (line.startsWith('chat template:')) return 'template'
  if (line.trim() === 'get complete') return 'done'
  return null
}
