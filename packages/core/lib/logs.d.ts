/**
 * The log-path template the plugin stores in a provider config. The user edits
 * it in a text field; the launch step resolves the placeholders against the
 * engine, the model it serves, and the launch time. ${HOME} is the host home
 * directory, not a shell expansion the plugin performs.
 */
export declare const DEFAULT_LOG_PATH_TEMPLATE = "${HOME}/.dsh/local-infer/logs/{{engine}}-{{model-name-slugified-and-truncated}}-{{YYMMDDHHMMSS###}}.log";
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
 * resolveLogPath fills a log-path template's placeholders with the engine id,
 * the slugified model name, and the timestamp token, and swaps ${HOME} for the
 * host home directory. A template with no placeholders is returned unchanged
 * (with ${HOME} still resolved), so a fully literal path works as-is.
 */
export declare function resolveLogPath(template: string, engineId: string, modelId: string | undefined, date: Date, home: string): string;
//# sourceMappingURL=logs.d.ts.map