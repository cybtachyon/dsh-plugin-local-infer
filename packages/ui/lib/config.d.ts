/**
 * The stored-config persistence the routes and ops share. The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. Every read sanitizes the file field by
 * field, so a by-hand edit never poisons the deploy step or the re-link rule.
 * @module dsh-plugin-local-infer/ui/config
 */
import type { Config, ProviderLaunchRecord } from 'dsh-plugin-local-infer/core';
/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export declare function localInferConfigPath(): string;
/**
 * StoredPlatformConfig is the per-engine platform config the deploy step
 * consumes (§3.10): where the engine platform lives locally and the git repo
 * that overrides the engine's default upstream. The map is keyed by engine id,
 * so the stored entry carries no id of its own; the route adds it when it
 * builds the EnginePlatformConfig the service registry stores.
 */
export interface StoredPlatformConfig {
    engineDirectory?: string;
    engineFork?: string;
    buildCommands?: string;
    dockerTag?: string;
}
/**
 * StoredProviderConfig is one saved provider model+engine config the card
 * lists: a stable id the card edits and deletes against, the engine and the
 * full parameter config it serves, the per-engine platform config the deploy
 * step consumes, and the launch record the launch step persists when it
 * starts the entry's engine (the engine pid, start time, launch arguments,
 * and the DSH process pid that launched it). The record is what a DSH
 * restart re-links a surviving engine to its config; a stop clears it.
 */
export interface StoredProviderConfig {
    id: string;
    engine: string;
    config: Config;
    platform: StoredPlatformConfig;
    launch?: ProviderLaunchRecord;
}
export interface StoredConfig {
    engine: string;
    config: Config;
    allowRunDeps: boolean;
    platform: Record<string, StoredPlatformConfig>;
    showHelp: boolean;
    providers: StoredProviderConfig[];
    logPath: string;
    lastLogs: string;
}
/**
 * readConfig reads the stored engine, config, trust gate, and per-engine
 * platform configs. A missing or broken file reads as the scaffold default
 * (NInfer, empty config, gate off, no platform configs) so the card always has
 * a form to draw. A platform entry that is not an object (or whose fields are
 * not strings) is dropped, so a by-hand edit never poisons the deploy step.
 */
export declare function readConfig(): StoredConfig;
/**
 * writeConfig persists the engine, config, trust gate, per-engine platform
 * configs, and the help toggle, creating the directory tree on first write.
 */
export declare function writeConfig(engine: string, config: Config, allowRunDeps: boolean, platform?: Record<string, StoredPlatformConfig>, showHelp?: boolean, providers?: StoredProviderConfig[], logPath?: string, lastLogs?: string): void;
/**
 * parsePlatformConfigs reads the stored platform map, keeping only entries
 * whose fields are strings. A non-object map or a non-object entry reads as
 * absent, so the deploy step never sees a platform config it cannot price.
 */
export declare function parsePlatformConfigs(raw: unknown): Record<string, StoredPlatformConfig>;
/**
 * parseStoredPlatformConfig reads one engine's platform config (the launch
 * request's `platform` key), keeping only string fields. A non-object or an
 * object with no string fields reads as absent, so the launch keeps the stored
 * entry the save route synced.
 */
export declare function parseStoredPlatformConfig(raw: unknown): StoredPlatformConfig | undefined;
//# sourceMappingURL=config.d.ts.map