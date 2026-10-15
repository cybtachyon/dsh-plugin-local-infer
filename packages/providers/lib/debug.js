/**
 * The DSH debug-mode detection for the local-inference providers. It combines
 * the two ways DSH enables debug mode (the HARNESS_LOG_LEVEL environment
 * variable and the DSH logger level config) into a single DebugLogger the
 * engine adapters use to capture the full build-to-launch command sequence.
 * @module dsh-plugin-local-infer/providers/debug
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { symbols } from '@deepseek-ai/cordis';
import { createCommandDebugLogger, isHarnessLogDebug, NOOP_DEBUG_LOGGER, } from '../../core/lib/index.js';
/**
 * The cordis logger level that enables debug mode: LoggerLevel.DEBUG.
 */
const DEBUG_LEVEL = 3;
/**
 * The command log file the debug logger appends to. It lives under the
 * plugin's ~/.dsh/local-infer directory, the same home the config and the
 * engine log files use, so a user debugging a launch finds the build-to-
 * launch command sequence in one place.
 */
const COMMAND_LOG_PATH = join(homedir(), '.dsh', 'local-infer', 'commands.log');
/**
 * createFileDebugLogger returns a DebugLogger that appends each command to the
 * command log file (defaulting to COMMAND_LOG_PATH), creating the directory on
 * first write. It is the sink that makes the HARNESS_LOG_LEVEL env var path
 * self-contained: the commands are captured to disk even when DSH's console
 * exporter does not surface debug messages. A write failure is swallowed, so a
 * full disk never breaks a launch.
 */
export function createFileDebugLogger(path = COMMAND_LOG_PATH) {
    let ready = false;
    return (message) => {
        if (!ready) {
            try {
                mkdirSync(dirname(path), { recursive: true });
                ready = true;
            }
            catch {
                // A directory that cannot be created keeps the logger quiet; the
                // cordis logger still carries the message.
                return;
            }
        }
        try {
            appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
        }
        catch {
            // A full disk or a read-only home never breaks the launch path.
        }
    };
}
/**
 * readDshLoggerLevel reads the effective DSH logger level from the context. It
 * checks the Logger facade's `level` (the `logger: { level: N }` config) and
 * the resolved intercept config's `levels.default` (the DSH logger patch's
 * `logger: { levels: { default: 3 } }`), walking the intercept prototype chain
 * the same way the LoggerService merges its config. An absent level reads as
 * undefined, which the caller treats as not-debug.
 */
function readDshLoggerLevel(ctx) {
    const facade = ctx.logger;
    if (typeof facade === 'function') {
        const level = facade().level;
        if (level !== undefined)
            return level;
    }
    let level;
    let intercept = ctx[symbols.intercept];
    while (intercept !== null) {
        const loggerConfig = intercept.logger;
        if (loggerConfig !== undefined) {
            level = loggerConfig.level ?? loggerConfig.levels?.default ?? level;
        }
        intercept = Object.getPrototypeOf(intercept);
    }
    return level;
}
/**
 * isDshDebugMode reports whether DSH is in debug mode: the HARNESS_LOG_LEVEL
 * env var set to DEBUG, or the DSH logger level config at the debug level.
 * Either signal turns on the command logger.
 */
export function isDshDebugMode(ctx) {
    if (isHarnessLogDebug())
        return true;
    const level = readDshLoggerLevel(ctx);
    return level !== undefined && level >= DEBUG_LEVEL;
}
/**
 * createDshDebugLogger builds the DebugLogger the engine adapters use to
 * capture the build-to-launch command sequence. Outside debug mode it returns
 * the no-op logger, so a normal run stays quiet. In debug mode it forwards each
 * command to both the cordis logger's debug method (so DSH's logger config
 * decides console visibility) and the command log file (so the HARNESS_LOG_LEVEL
 * env var path is captured to disk even when the console does not surface
 * debug messages).
 */
export function createDshDebugLogger(ctx) {
    if (!isDshDebugMode(ctx))
        return NOOP_DEBUG_LOGGER;
    const fileEmit = createFileDebugLogger();
    return createCommandDebugLogger({
        debug: true,
        emit: (message) => {
            ctx.logger('local-infer').debug(message);
            fileEmit(message);
        },
    });
}
//# sourceMappingURL=debug.js.map