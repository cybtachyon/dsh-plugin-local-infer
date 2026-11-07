/**
 * The last-run log persistence the card's process steps use: persistProcessLog
 * appends one run's output (a Get's commands and output, a model download's
 * result, a stop's failure note) to the stored last-run logs (the card's Logs
 * section shows it after a reload) and writes the run to the configured log
 * file, the same per-run file rule the launch step applies; captureRunBaseline
 * and finishRunSection close a streamed run so its provisional mid-run notes
 * and its final text persist once.
 * @module dsh-plugin-local-infer/ui/ops/logs
 */
import type { StoredConfig } from '../config.ts';
/**
 * The run seeds are the `--- <process>...` separator lines that lead each
 * provider process's run: the persisted section and the live run-log buffer
 * share the constant, so the streamed run reads like the persisted one. The
 * launch, get, and download steps already wrote these lines; the live hub
 * reuses them.
 */
export declare const GET_RUN_SEED = "--- Getting engine and model...\n";
export declare const LAUNCH_RUN_SEED = "--- Launching...\n";
export declare const DOWNLOAD_RUN_SEED = "--- Downloading...\n";
export declare const INSTALL_RUN_SEED = "--- Installing deps...\n";
export declare const STOP_RUN_SEED = "--- Stopping...\n";
/**
 * CANCELED_LINE is the "Canceled" line a client-disconnect cancel appends to
 * the persisted run, so the Logs section and the log file read the run as
 * canceled, the same line the card writes to its Logs buffer on the Cancel.
 * Every canceled run (Get, launch, download, chat template) writes it from
 * here.
 */
export declare const CANCELED_LINE = "--- Canceled\n";
/**
 * persistProcessLog appends one process run's output to the stored last-run
 * logs (capped to the launch logs' tail, so a long build cannot grow the
 * config without bound) and writes the run to the configured log file. A
 * missing log location (the field is optional) skips the file, the same rule
 * the launch step uses. An empty output is a no-op.
 */
export declare function persistProcessLog(output: string): void;
/**
 * captureRunBaseline reads the stored last-run logs at the start of a run.
 * The route passes it to finishRunSection when the run settles, so the
 * finished run replaces the run's own provisional mid-run appends instead of
 * appending the same text a second time under the section (the sudo CLI note
 * persists while the run hangs on the password prompt and then rides the
 * collected run text too).
 */
export declare function captureRunBaseline(): string;
/**
 * finishRunSection closes one settled run: the stored last-run logs become
 * the run's baseline plus the finished run section, replacing (not stacking
 * over) the run's provisional mid-run appends, so a line that both persisted
 * mid-run and rides the collected section persists exactly once. Tradeoff,
 * accepted on purpose: another writer's append that landed between the
 * baseline and the close is overwritten; the run owns the card's control
 * while it runs, and the launch path already overwrites the stored logs
 * wholesale (ops/engine.ts persistLaunchLogs). The section lands in the
 * configured log file under the same per-run file rule persistProcessLog
 * uses. An empty section is a no-op.
 */
export declare function finishRunSection(baseline: string, section: string): void;
/**
 * capRunLogs keeps one stored run's text within the shared LOG_TAIL_BYTES
 * tail, the same bound the live hub buffer and every lastLogs writer apply.
 * joinRunLogs and the wholesale launch persisters (ops/engine.ts
 * persistStoredLogs, persistLaunchLogs) share this one cap rule.
 */
export declare function capRunLogs(logs: string): string;
/**
 * writeRunFile writes one run's text to the configured log file named for
 * its engine and model. The launch persisters pass the launch's own engine
 * and config; the append paths pass the stored ones (the defaults). A
 * missing log location (the field is optional) skips the file; a file that
 * cannot be written must not fail the run, since the in-memory last-run logs
 * still reach the card. Every run writer shares this one file rule.
 */
export declare function writeRunFile(stored: StoredConfig, output: string, engineId?: string, modelId?: string | undefined): void;
//# sourceMappingURL=logs.d.ts.map
