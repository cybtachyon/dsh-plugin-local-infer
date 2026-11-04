/**
 * The last-run log persistence the card's process steps use: persistProcessLog
 * appends one run's output (a Get's commands and output, a model download's
 * result, a stop's failure note) to the stored last-run logs (the card's Logs
 * section shows it after a reload) and writes the run to the configured log
 * file, the same per-run file rule the launch step applies.
 * @module dsh-plugin-local-infer/ui/ops/logs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { LOG_TAIL_BYTES, resolveLogPath } from '../../../core/lib/index.js';
import { readConfig, writeStored } from "../config.js";
/**
 * persistProcessLog appends one process run's output to the stored last-run
 * logs (capped to the launch logs' tail, so a long build cannot grow the
 * config without bound) and writes the run to the configured log file. A
 * missing log location (the field is optional) skips the file, the same rule
 * the launch step uses. An empty output is a no-op.
 */
export function persistProcessLog(output) {
    if (output === '')
        return;
    const stored = readConfig();
    const joined = `${stored.lastLogs}${stored.lastLogs === '' ? '' : '\n'}${output}`;
    writeStored(stored, { lastLogs: joined.slice(-LOG_TAIL_BYTES) });
    if (stored.logPath === undefined || stored.logPath === '')
        return;
    const modelId = typeof stored.config.model === 'string' ? stored.config.model : undefined;
    const logPath = resolveLogPath(stored.logPath, stored.engine, modelId, new Date(), homedir());
    try {
        mkdirSync(dirname(logPath), { recursive: true });
        writeFileSync(logPath, output);
    }
    catch {
        // A log file that cannot be written (a read-only dir, a bad path) must not
        // fail the run; the in-memory last-run logs still reach the card.
    }
}
//# sourceMappingURL=logs.js.map
