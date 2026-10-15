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
 * DebugLogger reports one engine command the plugin issued. The host calls it
 * for every `run` and `spawn` so the full build-to-launch sequence is captured.
 * A no-op instance is returned outside debug mode.
 */
export type DebugLogger = (message: string) => void;
/**
 * NOOP_DEBUG_LOGGER is the debug logger returned outside debug mode. It
 * discards its message, so the command path pays no allocation or I/O cost.
 */
export declare const NOOP_DEBUG_LOGGER: DebugLogger;
/**
 * isHarnessLogDebug reports whether the HARNESS_LOG_LEVEL environment variable
 * enables debug mode. A value of DEBUG (case-insensitive) or the numeric level
 * 3 reads as debug; any other value (or an absent variable) reads as off.
 */
export declare function isHarnessLogDebug(env?: NodeJS.ProcessEnv): boolean;
/**
 * CreateCommandDebugLoggerArgs tunes the command debug logger: `debug` gates
 * whether the logger emits at all, and `emit` is the sink that receives each
 * command message (the cordis logger's debug method in the live host).
 */
export interface CreateCommandDebugLoggerArgs {
    debug?: boolean;
    emit?: (message: string) => void;
}
/**
 * createCommandDebugLogger returns a DebugLogger that forwards each command to
 * `emit` when `debug` is true and `emit` is provided, and a no-op otherwise.
 * The gate keeps the command path quiet in normal operation and silent when
 * no sink is wired, so a bare host never throws on a missing logger.
 */
export declare function createCommandDebugLogger(args: CreateCommandDebugLoggerArgs): DebugLogger;
//# sourceMappingURL=debug.d.ts.map