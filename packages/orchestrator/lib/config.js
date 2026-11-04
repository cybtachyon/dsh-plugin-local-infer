/**
 * The Orchestrator prompt store: the saved prompt file under
 * ~/.dsh/local-infer/orchestrator.json, the shipped prompt.md default, and
 * the in-memory holder the system-prompt section and the settings routes
 * share. Every read sanitizes the file, so a by-hand edit never poisons the
 * injected prompt. Mirrors the sanitize-on-read discipline of
 * packages/ui/src/config.ts.
 * @module dsh-plugin-local-infer/orchestrator/config
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/**
 * orchestratorConfigPath names the file this package owns. It sits in the
 * shared local-infer dir beside the ui config so one place holds everything
 * the plugin persists.
 */
export function orchestratorConfigPath() {
    return join(homedir(), '.dsh', 'local-infer', 'orchestrator.json');
}
/**
 * readOrchestratorConfig reads the saved prompt. A missing or broken file,
 * or a prompt field that is not a string, reads as no saved prompt (empty),
 * so a first open and a by-hand edit both land on the default instead of
 * throwing.
 */
export function readOrchestratorConfig() {
    const path = orchestratorConfigPath();
    if (!existsSync(path)) {
        return { prompt: '' };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return { prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '' };
    }
    catch {
        return { prompt: '' };
    }
}
/**
 * writeOrchestratorConfig persists the prompt, creating the directory tree
 * on first write the same way the ui config write does.
 */
export function writeOrchestratorConfig(config) {
    const path = orchestratorConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ prompt: config.prompt }, null, 2));
}
// Cache of the shipped prompt.md text: the file never changes while the
// process runs, so only a successful read is kept and a failed read retries
// on the next call instead of locking in the empty fallback.
let defaultPromptCache;
/**
 * defaultOrchestratorPrompt returns the shipped prompt.md text read from the
 * package root. The URL hop is relative to this module, so src/ and lib/
 * depths both resolve one level up to the package root. The read is cached;
 * an unreadable file yields '' without throwing.
 */
export function defaultOrchestratorPrompt() {
    if (defaultPromptCache === undefined) {
        try {
            defaultPromptCache = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8');
        }
        catch {
            return '';
        }
    }
    return defaultPromptCache;
}
// The effective prompt holder: null until the first read refreshes it from
// the file, then the saved value or the default until the setter persists a
// new one.
let effectivePrompt = null;
/**
 * getOrchestratorPrompt returns the effective prompt: the saved value when a
 * non-empty one exists, otherwise the shipped default. The first call reads
 * the file once and caches, so the system-prompt section pays no per-message
 * disk read.
 */
export function getOrchestratorPrompt() {
    if (effectivePrompt === null) {
        effectivePrompt = toEffective(readOrchestratorConfig().prompt);
    }
    return effectivePrompt;
}
/**
 * setOrchestratorPrompt persists the prompt and refreshes the holder, so the
 * injected section picks the new text up without another file read. An empty
 * save means "no saved prompt" and falls back to the default.
 */
export function setOrchestratorPrompt(prompt) {
    writeOrchestratorConfig({ prompt });
    effectivePrompt = toEffective(prompt);
}
/**
 * hasSavedOrchestratorPrompt reports whether the file holds a saved prompt
 * override. The empty string is the store's sentinel for "no saved prompt",
 * so the settings routes read the flag through here instead of re-deriving
 * the sentinel rule the holder already applies.
 */
export function hasSavedOrchestratorPrompt() {
    return readOrchestratorConfig().prompt !== '';
}
/**
 * toEffective resolves one saved value against the default: an empty saved
 * prompt reads as no saved prompt.
 */
function toEffective(saved) {
    return saved === '' ? defaultOrchestratorPrompt() : saved;
}
//# sourceMappingURL=config.js.map
