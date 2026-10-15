/**
 * The log-directory the plugin stores in a provider config. The user edits it
 * in a text field; the launch step saves each run's log file inside it, named
 * from the fixed file-name template below. ${HOME} is the host home directory,
 * not a shell expansion the plugin performs.
 */
export declare const DEFAULT_LOG_PATH_TEMPLATE = "${HOME}/.dsh/local-infer/logs";
/**
 * LOG_FILE_NAME_TEMPLATE is the fixed file name a launch's log file carries,
 * inside the user-edited log directory. The placeholders resolve against the
 * engine, the model it serves, and the launch time, so concurrent launches of
 * the same model keep distinct files.
 */
export declare const LOG_FILE_NAME_TEMPLATE = "{{engine}}-{{model-name-slugified-and-truncated}}-{{YYMMDDHHMMSS###}}.log";
/**
 * The template placeholders, named so the resolver and the config field stay
 * in sync with the default the card shows.
 */
export declare const LOG_TEMPLATE_HOME = "${HOME}";
export declare const LOG_TEMPLATE_ENGINE = "{{engine}}";
export declare const LOG_TEMPLATE_MODEL = "{{model-name-slugified-and-truncated}}";
export declare const LOG_TEMPLATE_TIMESTAMP = "{{YYMMDDHHMMSS###}}";
/**
 * slugifyModelName turns a model name into a file-safe slug: lowercase,
 * non-alphanumeric runs become a single hyphen, edge hyphens trimmed, and the
 * result truncated to maxLen. A blank name reads as "model", so a config that
 * names no model still gets a distinguishable file.
 */
export declare function slugifyModelName(name: string | undefined, maxLen?: number): string;
/**
 * formatLogTimestamp renders a Date as the template's YYMMDDHHMMSS### token: a
 * two-digit year, month, day, hour, minute, second, and a three-digit
 * millisecond field, all zero-padded.
 */
export declare function formatLogTimestamp(date: Date): string;
/**
 * resolveLogPath resolves a user-edited log directory to the full path of a
 * launch's log file. It swaps ${HOME} in the directory for the host home
 * directory, then names the file from LOG_FILE_NAME_TEMPLATE against the
 * engine id, the slugified model name, and the launch time, so each run keeps
 * its own file inside the directory. A directory with no ${HOME} is used as-is.
 */
export declare function resolveLogPath(directory: string, engineId: string, modelId: string | undefined, date: Date, home: string): string;
//# sourceMappingURL=logs.d.ts.map