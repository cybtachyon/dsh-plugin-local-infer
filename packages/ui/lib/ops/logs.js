/**
 * The last-run log persistence the Get step uses: persistGetLogs appends one
 * Get run's streamed output to the stored last-run logs (the card's Logs
 * section shows it after a reload) and writes no log file: the launch step
 * owns the per-run files.
 * @module dsh-plugin-local-infer/ui/ops/logs
 */
import { readConfig, writeConfig } from "../config.js";
/**
 * persistGetLogs appends one Get run's streamed output to the stored last-
 * run logs (the card's Logs section shows it after a reload) and writes no
 * log file: the launch step owns the per-run files. The tail rule matches
 * the launch logs' cap, so a long build cannot grow the config without
 * bound.
 */
export function persistGetLogs(output) {
    if (output === '')
        return;
    const stored = readConfig();
    const joined = `${stored.lastLogs}${stored.lastLogs === '' ? '' : '\n'}${output}`;
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, stored.providers, stored.logPath, joined.slice(-65536));
}
//# sourceMappingURL=logs.js.map