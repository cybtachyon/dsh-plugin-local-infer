/**
 * The stored-config persistence the routes and ops share. The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. Every read sanitizes the file field by
 * field, so a by-hand edit never poisons the deploy step or the re-link rule.
 * @module dsh-plugin-local-infer/ui/config
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { DEFAULT_LOG_PATH_TEMPLATE } from '../../core/lib/index.js';
/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export function localInferConfigPath() {
    return join(homedir(), '.dsh', 'local-infer', 'config.json');
}
/**
 * readConfig reads the stored engine, config, trust gate, and per-engine
 * platform configs. A missing or broken file reads as the scaffold default
 * (NInfer, empty config, gate off, no platform configs) so the card always has
 * a form to draw. A platform entry that is not an object (or whose fields are
 * not strings) is dropped, so a by-hand edit never poisons the deploy step.
 */
export function readConfig() {
    const path = localInferConfigPath();
    if (!existsSync(path)) {
        return {
            engine: 'ninfer',
            config: {},
            allowRunDeps: false,
            platform: {},
            showHelp: true,
            providers: [],
            logPath: DEFAULT_LOG_PATH_TEMPLATE,
            lastLogs: '',
        };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return {
            engine: typeof parsed.engine === 'string' ? parsed.engine : 'ninfer',
            config: parsed.config && typeof parsed.config === 'object' ? parsed.config : {},
            allowRunDeps: typeof parsed.allowRunDeps === 'boolean' ? parsed.allowRunDeps : false,
            platform: parsePlatformConfigs(parsed.platform),
            // A file that predates the key (or carries a non-boolean) reads as
            // descriptions visible, the default the card draws on first open.
            showHelp: typeof parsed.showHelp === 'boolean' ? parsed.showHelp : true,
            providers: parseProviders(parsed.providers),
            // A file that predates the key reads as the plugin's default log dir,
            // and the last-run logs start empty until a launch fills them.
            logPath: typeof parsed.logPath === 'string' && parsed.logPath !== ''
                ? parsed.logPath
                : DEFAULT_LOG_PATH_TEMPLATE,
            lastLogs: typeof parsed.lastLogs === 'string' ? parsed.lastLogs : '',
        };
    }
    catch {
        return {
            engine: 'ninfer',
            config: {},
            allowRunDeps: false,
            platform: {},
            showHelp: true,
            providers: [],
            logPath: DEFAULT_LOG_PATH_TEMPLATE,
            lastLogs: '',
        };
    }
}
/**
 * parseProviders reads the stored provider list, keeping only entries with a
 * non-blank string id. A non-object entry or an entry with no id is dropped,
 * so a by-hand edit never poisons the card's provider list. The per-engine
 * platform config is read through the same string-field rule the platform map
 * uses, so a provider never carries a platform field it cannot price.
 */
function parseProviders(raw) {
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw)) {
        return [];
    }
    const providers = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const fields = entry;
        if (typeof fields.id !== 'string' || fields.id.trim() === '')
            continue;
        const engine = typeof fields.engine === 'string' ? fields.engine : 'ninfer';
        const config = fields.config && typeof fields.config === 'object' ? fields.config : {};
        const platform = parseStoredPlatformConfig(fields.platform) ?? {};
        const provider = { id: fields.id, engine, config, platform };
        const launch = parseLaunchRecord(fields.launch);
        if (launch !== undefined) {
            provider.launch = launch;
        }
        providers.push(provider);
    }
    return providers;
}
/**
 * parseLaunchRecord reads one stored launch record, keeping only the fields
 * the re-link rule prices (the engine pid, the start time, the argv, the
 * parent and previous pids, and the engine/model/port the detector ties the
 * engine to). A record that is not an object, or that names no integer pid
 * or engine id, is dropped, so a by-hand edit never poisons the re-link.
 */
function parseLaunchRecord(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }
    const fields = raw;
    if (typeof fields.pid !== 'number' || !Number.isInteger(fields.pid)) {
        return undefined;
    }
    if (typeof fields.startedAt !== 'string' || fields.startedAt === '') {
        return undefined;
    }
    if (typeof fields.engineId !== 'string' || fields.engineId.trim() === '') {
        return undefined;
    }
    const record = {
        pid: fields.pid,
        startedAt: fields.startedAt,
        argv: Array.isArray(fields.argv)
            ? fields.argv.filter((part) => typeof part === 'string')
            : [],
        previousPids: Array.isArray(fields.previousPids)
            ? fields.previousPids.filter((part) => typeof part === 'number')
            : [],
        engineId: fields.engineId,
    };
    if (typeof fields.parentPid === 'number') {
        record.parentPid = fields.parentPid;
    }
    if (typeof fields.modelId === 'string' && fields.modelId !== '') {
        record.modelId = fields.modelId;
    }
    if (typeof fields.port === 'number') {
        record.port = fields.port;
    }
    return record;
}
/**
 * writeConfig persists the engine, config, trust gate, per-engine platform
 * configs, and the help toggle, creating the directory tree on first write.
 */
export function writeConfig(engine, config, allowRunDeps, platform, showHelp, providers, logPath, lastLogs) {
    const path = localInferConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
        engine,
        config,
        allowRunDeps,
        platform: platform ?? {},
        showHelp: showHelp ?? true,
        providers: providers ?? [],
        logPath: logPath ?? DEFAULT_LOG_PATH_TEMPLATE,
        lastLogs: lastLogs ?? '',
    }, null, 2));
}
/**
 * parsePlatformConfigs reads the stored platform map, keeping only entries
 * whose fields are strings. A non-object map or a non-object entry reads as
 * absent, so the deploy step never sees a platform config it cannot price.
 */
export function parsePlatformConfigs(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    const platform = {};
    for (const [engineId, entry] of Object.entries(raw)) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const stored = {};
        const fields = entry;
        if (typeof fields.engineDirectory === 'string') {
            stored.engineDirectory = fields.engineDirectory;
        }
        if (typeof fields.engineFork === 'string') {
            stored.engineFork = fields.engineFork;
        }
        if (typeof fields.buildCommands === 'string') {
            stored.buildCommands = fields.buildCommands;
        }
        if (typeof fields.dockerTag === 'string') {
            stored.dockerTag = fields.dockerTag;
        }
        if (stored.engineDirectory !== undefined ||
            stored.engineFork !== undefined ||
            stored.buildCommands !== undefined ||
            stored.dockerTag !== undefined) {
            platform[engineId] = stored;
        }
    }
    return platform;
}
/**
 * parseStoredPlatformConfig reads one engine's platform config (the launch
 * request's `platform` key), keeping only string fields. A non-object or an
 * object with no string fields reads as absent, so the launch keeps the stored
 * entry the save route synced.
 */
export function parseStoredPlatformConfig(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }
    const fields = raw;
    const stored = {};
    if (typeof fields.engineDirectory === 'string') {
        stored.engineDirectory = fields.engineDirectory;
    }
    if (typeof fields.engineFork === 'string') {
        stored.engineFork = fields.engineFork;
    }
    if (typeof fields.buildCommands === 'string') {
        stored.buildCommands = fields.buildCommands;
    }
    if (typeof fields.dockerTag === 'string') {
        stored.dockerTag = fields.dockerTag;
    }
    if (stored.engineDirectory === undefined &&
        stored.engineFork === undefined &&
        stored.buildCommands === undefined &&
        stored.dockerTag === undefined) {
        return undefined;
    }
    return stored;
}
//# sourceMappingURL=config.js.map