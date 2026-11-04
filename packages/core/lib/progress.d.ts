/**
 * The pure hf (huggingface_hub) tqdm progress parser the get and launch routes
 * share: it turns the raw tqdm stderr lines into a structured HfProgress
 * state, so a route's onChunk sink (the download runner's streamed stderr)
 * feeds the card's progress events without a node import. The parser
 * recognizes the two tqdm bar shapes the hf CLI emits with `--format human`:
 * the file-count bar (`Fetching 102 files: 42%|...| 43/102 [00:01<00:02,
 * 20.5it/s]`, where the done/total fields carry file counts, not bytes) and
 * the byte bar (`Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11,
 * 72.3MB/s]`, where the done/total fields carry human byte sizes). It
 * converts the human byte sizes to bytes and the `[elapsed<remaining, rate]`
 * tail to remaining seconds. The client package mirrors this parser in
 * `packages/client/src/store/progress.ts` (the TASK-006 browser-side copy):
 * the core package is not browser-safe, so the client bundle keeps its own
 * copy and the two shapes (`HfProgress` and the client's `HfProgressShape`)
 * must stay in sync when a tqdm bar shape changes.
 * @module dsh-plugin-local-infer/core/progress
 */
/**
 * HfProgress is the structured state one tqdm bar update folds to: the step
 * label the bar names (the file, or the file-count fetch), the percent
 * complete, the done and total amounts (bytes for the byte bar, file counts
 * for the file-count bar), and the remaining time in seconds (0 when the bar
 * carries no tail).
 */
export interface HfProgress {
    step: string;
    percent: number;
    doneBytes: number;
    totalBytes: number;
    etaSeconds: number;
}
/**
 * parseHfProgressLine parses one tqdm bar line into an HfProgress state, or
 * undefined when the line is not a bar update (a plain log line, a command
 * echo). It recognizes the file-count and byte shapes above.
 */
export declare function parseHfProgressLine(line: string): HfProgress | undefined;
/**
 * foldHfProgressChunk folds a raw stderr chunk into the latest HfProgress
 * state it carries: the chunk splits on the line separators tqdm writes
 * (carriage returns between bar redraws, newlines between steps), each line
 * parses through parseHfProgressLine, and the last parseable line wins. A
 * chunk with no bar update returns the prior state, so a caller threads the
 * fold across chunks and always holds the newest state.
 */
export declare function foldHfProgressChunk(chunk: string, prior: HfProgress | undefined): HfProgress | undefined;
//# sourceMappingURL=progress.d.ts.map
