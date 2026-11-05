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
//# sourceMappingURL=logs.d.ts.map
