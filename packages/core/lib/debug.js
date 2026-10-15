/**
 * The debug-mode command logger for the local-inference plugin. When DSH runs
 * in debug mode, the plugin logs the full set of commands it issues to an
 * engine, from build to launch. Debug mode is enabled two ways, both honored
 * here: the `HARNESS_LOG_LEVEL` environment variable set to `DEBUG`, and the
 * DSH logger level config (`logger: { levels: { default: 3 } }`) that a DSH
 * `--patch` overlay applies. The logger is a no-op outside debug mode, so the
 * command path stays allocation-free in normal operation.
 * @module @dsh/dsh-plugin-local-infer/core/debug
 */
/**
 * NOOP_DEBUG_LOGGER is the debug logger returned outside debug mode. It
 * discards its message, so the command path pays no allocation or I/O cost.
 */
export const NOOP_DEBUG_LOGGER = () => { };
/**
 * The HARNESS_LOG_LEVEL values that enable debug mode: the word `DEBUG`
 * (case-insensitive) and the numeric level 3, the cordis LoggerLevel.DEBUG.
 */
const DEBUG_LEVEL_VALUES = new Set(['debug', '3']);
/**
 * isHarnessLogDebug reports whether the HARNESS_LOG_LEVEL environment variable
 * enables debug mode. A value of DEBUG (case-insensitive) or the numeric level
 * 3 reads as debug; any other value (or an absent variable) reads as off.
 */
export function isHarnessLogDebug(env = process.env) {
    const raw = env.HARNESS_LOG_LEVEL;
    if (raw === undefined)
        return false;
    return DEBUG_LEVEL_VALUES.has(raw.trim().toLowerCase());
}
/**
 * createCommandDebugLogger returns a DebugLogger that forwards each command to
 * `emit` when `debug` is true and `emit` is provided, and a no-op otherwise.
 * The gate keeps the command path quiet in normal operation and silent when
 * no sink is wired, so a bare host never throws on a missing logger.
 */
export function createCommandDebugLogger(args) {
    if (args.debug !== true || args.emit === undefined)
        return NOOP_DEBUG_LOGGER;
    return args.emit;
}
//# sourceMappingURL=debug.js.map