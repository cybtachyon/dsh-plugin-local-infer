/**
 * The last-run log persistence the card's process steps use: appendProcessLog
 * appends one run's output (a Get's commands and output, a model download's
 * result) to the stored last-run logs (the card's Logs section shows it after a
 * reload) and writes the run to the configured log file, the same per-run file
 * rule the launch step applies. persistGetLogs and persistDownloadLog are the
 * step-specific wrappers.
 * @module dsh-plugin-local-infer/ui/ops/logs
 */
/**
 * persistGetLogs appends one Get run's streamed output (the commands and their
 * output) to the stored last-run logs and writes the run to the configured log
 * file, the same per-run file rule the launch step applies.
 */
export declare function persistGetLogs(output: string): void;
/**
 * persistDownloadLog appends one model or chat-template download's result to the
 * stored last-run logs and writes the run to the configured log file, so the
 * card's Logs section and the log file show the download beside the Get and
 * launch runs.
 */
export declare function persistDownloadLog(output: string): void;
//# sourceMappingURL=logs.d.ts.map