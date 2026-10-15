/**
 * The DSH debug-mode detection for the local-inference providers. It combines
 * the two ways DSH enables debug mode (the HARNESS_LOG_LEVEL environment
 * variable and the DSH logger level config) into a single DebugLogger the
 * engine adapters use to capture the full build-to-launch command sequence.
 * @module dsh-plugin-local-infer/providers/debug
 */
import { Context } from '@deepseek-ai/cordis';
import { type DebugLogger } from '../../core/lib/index.js';
/**
 * createFileDebugLogger returns a DebugLogger that appends each command to the
 * command log file (defaulting to COMMAND_LOG_PATH), creating the directory on
 * first write. It is the sink that makes the HARNESS_LOG_LEVEL env var path
 * self-contained: the commands are captured to disk even when DSH's console
 * exporter does not surface debug messages. A write failure is swallowed, so a
 * full disk never breaks a launch.
 */
export declare function createFileDebugLogger(path?: string): DebugLogger;
/**
 * isDshDebugMode reports whether DSH is in debug mode: the HARNESS_LOG_LEVEL
 * env var set to DEBUG, or the DSH logger level config at the debug level.
 * Either signal turns on the command logger.
 */
export declare function isDshDebugMode(ctx: Context): boolean;
/**
 * createDshDebugLogger builds the DebugLogger the engine adapters use to
 * capture the build-to-launch command sequence. Outside debug mode it returns
 * the no-op logger, so a normal run stays quiet. In debug mode it forwards each
 * command to both the cordis logger's debug method (so DSH's logger config
 * decides console visibility) and the command log file (so the HARNESS_LOG_LEVEL
 * env var path is captured to disk even when the console does not surface
 * debug messages).
 */
export declare function createDshDebugLogger(ctx: Context): DebugLogger;
//# sourceMappingURL=debug.d.ts.map