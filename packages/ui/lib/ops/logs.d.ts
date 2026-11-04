/**
 * The last-run log persistence the card's process steps use: persistProcessLog
 * appends one run's output (a Get's commands and output, a model download's
 * result, a stop's failure note) to the stored last-run logs (the card's Logs
 * section shows it after a reload) and writes the run to the configured log
 * file, the same per-run file rule the launch step applies.
 * @module dsh-plugin-local-infer/ui/ops/logs
 */
/**
 * persistProcessLog appends one process run's output to the stored last-run
 * logs (capped to the launch logs' tail, so a long build cannot grow the
 * config without bound) and writes the run to the configured log file. A
 * missing log location (the field is optional) skips the file, the same rule
 * the launch step uses. An empty output is a no-op.
 */
export declare function persistProcessLog(output: string): void;
//# sourceMappingURL=logs.d.ts.map
