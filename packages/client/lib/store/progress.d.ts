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
import type { HfProgressShape } from '../api/routes.ts';
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
export type GetProgressState = HfProgressShape;
/** The Get step the step chips and the progress readout derive. */
export type GetStep = 'deps' | 'clone' | 'build' | 'model' | 'template' | 'done';
/**
 * parseHfProgress folds a streamed chunk into the latest GetProgressState it
 * carries: the chunk splits on the line separators tqdm writes (carriage
 * returns between bar redraws, newlines between steps), each line parses
 * through parseHfProgressLine, and the last parseable line wins. A chunk
 * with no bar update returns the prior state, so a caller threads the fold
 * across chunks and always holds the newest state.
 */
export declare function parseHfProgress(chunk: string, prior: GetProgressState | null): GetProgressState | null;
/**
 * deriveGetStep maps the step-header lines get-steps emits to the current
 * Get step: it scans the log text line by line, and the last recognized
 * header wins, so the step chips and the progress readout read one
 * derivation. It returns null when the log carries no header (a run that
 * has not reached a step yet).
 */
export declare function deriveGetStep(log: string): GetStep | null;
//# sourceMappingURL=progress.d.ts.map
