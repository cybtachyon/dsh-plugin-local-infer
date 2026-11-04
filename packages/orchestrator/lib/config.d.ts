/**
 * The Orchestrator prompt store: the saved prompt file under
 * ~/.dsh/local-infer/orchestrator.json, the shipped prompt.md default, and
 * the in-memory holder the system-prompt section and the settings routes
 * share. Every read sanitizes the file, so a by-hand edit never poisons the
 * injected prompt. Mirrors the sanitize-on-read discipline of
 * packages/ui/src/config.ts.
 * @module dsh-plugin-local-infer/orchestrator/config
 */
/**
 * orchestratorConfigPath names the file this package owns. It sits in the
 * shared local-infer dir beside the ui config so one place holds everything
 * the plugin persists.
 */
export declare function orchestratorConfigPath(): string;
/**
 * StoredOrchestratorConfig is the whole persisted shape: the saved prompt,
 * where an empty string carries "no saved prompt" so the holder falls back
 * to the shipped default.
 */
export interface StoredOrchestratorConfig {
    prompt: string;
}
/**
 * readOrchestratorConfig reads the saved prompt. A missing or broken file,
 * or a prompt field that is not a string, reads as no saved prompt (empty),
 * so a first open and a by-hand edit both land on the default instead of
 * throwing.
 */
export declare function readOrchestratorConfig(): StoredOrchestratorConfig;
/**
 * writeOrchestratorConfig persists the prompt, creating the directory tree
 * on first write the same way the ui config write does.
 */
export declare function writeOrchestratorConfig(config: StoredOrchestratorConfig): void;
/**
 * defaultOrchestratorPrompt returns the shipped prompt.md text read from the
 * package root. The URL hop is relative to this module, so src/ and lib/
 * depths both resolve one level up to the package root. The read is cached;
 * an unreadable file yields '' without throwing.
 */
export declare function defaultOrchestratorPrompt(): string;
/**
 * getOrchestratorPrompt returns the effective prompt: the saved value when a
 * non-empty one exists, otherwise the shipped default. The first call reads
 * the file once and caches, so the system-prompt section pays no per-message
 * disk read.
 */
export declare function getOrchestratorPrompt(): string;
/**
 * setOrchestratorPrompt persists the prompt and refreshes the holder, so the
 * injected section picks the new text up without another file read. An empty
 * save means "no saved prompt" and falls back to the default.
 */
export declare function setOrchestratorPrompt(prompt: string): void;
/**
 * hasSavedOrchestratorPrompt reports whether the file holds a saved prompt
 * override. The empty string is the store's sentinel for "no saved prompt",
 * so the settings routes read the flag through here instead of re-deriving
 * the sentinel rule the holder already applies.
 */
export declare function hasSavedOrchestratorPrompt(): boolean;
//# sourceMappingURL=config.d.ts.map
