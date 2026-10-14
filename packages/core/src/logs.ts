/**
 * The log-path template the plugin stores in a provider config. The user edits
 * it in a text field; the launch step resolves the placeholders against the
 * engine, the model it serves, and the launch time. ${HOME} is the host home
 * directory, not a shell expansion the plugin performs.
 */
export const DEFAULT_LOG_PATH_TEMPLATE =
  '${HOME}/.dsh/local-infer/logs/{{engine}}-{{model-name-slugified-and-truncated}}-{{YYMMDDHHMMSS###}}.log'

/**
 * The template placeholders, named so the resolver and the config field stay
 * in sync with the default the card shows.
 */
export const LOG_TEMPLATE_HOME = '${HOME}'
export const LOG_TEMPLATE_ENGINE = '{{engine}}'
export const LOG_TEMPLATE_MODEL = '{{model-name-slugified-and-truncated}}'
export const LOG_TEMPLATE_TIMESTAMP = '{{YYMMDDHHMMSS###}}'

/**
 * slugifyModelName turns a model name into a file-safe slug: lowercase,
 * non-alphanumeric runs become a single hyphen, edge hyphens trimmed, and the
 * result truncated to maxLen. A blank name reads as "model", so a config that
 * names no model still gets a distinguishable file.
 */
export function slugifyModelName(name: string | undefined, maxLen = 24): string {
  const source = name === undefined || name === '' ? 'model' : name
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
  return slug === '' ? 'model' : slug
}

/**
 * formatLogTimestamp renders a Date as the template's YYMMDDHHMMSS### token: a
 * two-digit year, month, day, hour, minute, second, and a three-digit
 * millisecond field, all zero-padded.
 */
export function formatLogTimestamp(date: Date): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0')
  return (
    pad(date.getFullYear() % 100, 2) +
    pad(date.getMonth() + 1, 2) +
    pad(date.getDate(), 2) +
    pad(date.getHours(), 2) +
    pad(date.getMinutes(), 2) +
    pad(date.getSeconds(), 2) +
    pad(date.getMilliseconds(), 3)
  )
}

/**
 * resolveLogPath fills a log-path template's placeholders with the engine id,
 * the slugified model name, and the timestamp token, and swaps ${HOME} for the
 * host home directory. A template with no placeholders is returned unchanged
 * (with ${HOME} still resolved), so a fully literal path works as-is.
 */
export function resolveLogPath(
  template: string,
  engineId: string,
  modelId: string | undefined,
  date: Date,
  home: string,
): string {
  return template
    .replace(LOG_TEMPLATE_HOME, home)
    .replace(LOG_TEMPLATE_ENGINE, engineId)
    .replace(LOG_TEMPLATE_MODEL, slugifyModelName(modelId))
    .replace(LOG_TEMPLATE_TIMESTAMP, formatLogTimestamp(date))
}
