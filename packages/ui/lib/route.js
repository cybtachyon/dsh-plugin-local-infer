/**
 * The webServer routes the Web card talks to. GET /local-infer/summary
 * returns the engine list, the detected hardware, the form model for the
 * selected engine, the VRAM meter model for the current config, the default
 * model list and the model status (presence, hf CLI, download command) the
 * banner and inline red warnings render from; POST /local-infer/save persists
 * the config; POST /local-infer/download runs the hf CLI download for a
 * default model; POST /local-infer/launch and /local-infer/stop drive the
 * engine lifecycle; and POST /local-infer/register and /local-infer/
 * unregister publish the engine as a DSH model through the settings seam.
 * The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The routes are held by an effect, so they
 * go when the plugin does.
 * @module dsh-plugin-local-infer/ui/route
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { CHAT_TEMPLATE_FILE, buildModelEntry, checkDeps, DEFAULT_LOG_PATH_TEMPLATE, formatLaunchCommand, hfChatTemplateCommand, hfDownloadCommand, launchRecordFromPlan, modelArtifactPath, modelEntriesForEngine, providerIdFor, renderInstallString, resolveLogPath, } from '../../core/lib/index.js';
import { CHAT_TEMPLATE_OPTIONS, buildEngineRepo, defaultModelFor, defaultModelsForEngine, ENGINES, enginePlatformDefaults, nodeLifecycleHost, syncEngineRepo, } from '../../providers/lib/index.js';
import { renderDeps } from "./deps.js";
import { renderForm } from "./form.js";
import { renderMeter } from "./meter.js";
import { renderWarnings } from "./warnings.js";
/**
 * isHfRepoReference reports whether a chat template value is a Hugging Face
 * repo reference (an owner/name pair) rather than a local path: it carries a
 * slash and does not start with one. Only repo references are auto-downloaded
 * into the model directory; a local path is used in place.
 */
function isHfRepoReference(value) {
    return value !== '' && !value.startsWith('/') && value.includes('/');
}
/**
 * chatTemplateLabel resolves the display label for a chat template repo: the
 * preset's label when the repo is a shipped preset, else the repo itself.
 */
function chatTemplateLabel(repo) {
    const preset = CHAT_TEMPLATE_OPTIONS.find((option) => option.value === repo);
    return preset?.label ?? repo;
}
/**
 * resolveModelRegistryId maps the card's model value onto the VramModel
 * registry key the estimator prices. The card's Model field carries either a
 * registry key (a default-model selection) or an artifact file name (a
 * directory-scan selection, e.g. a .ninfer file); the default list maps the
 * file name to the registry key the estimator knows, so a scanned model prices
 * a real VramModel rather than reading as not-measured. A value that is
 * already a registry key passes through, and a missing value falls back to
 * the engine's first default model.
 */
function resolveModelRegistryId(engineId, model) {
    if (typeof model === 'string' && model !== '') {
        const entry = defaultModelsForEngine(engineId).find((candidate) => candidate.file === model);
        return entry?.modelId ?? model;
    }
    return defaultModelsForEngine(engineId)[0]?.modelId ?? engineId;
}
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
 * newProviderId mints the stable id a new provider entry carries: a
 * timestamp base plus a random tail, so two Saves in the same tick never
 * collide. The card edits and deletes against this id.
 */
function newProviderId() {
    return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
function parsePlatformConfigs(raw) {
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
function parseStoredPlatformConfig(raw) {
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
/**
 * relinkStoredProviders prices every stored provider launch record against the
 * live process table through the service's re-link rule and returns the
 * provider list the card should read: an adopted engine is re-marked plugin-
 * launched and tied to its model by the service, and a liveness watcher starts
 * on its port so a later pkill settles the stored state through the death
 * observer without another summary read; a dead engine's record is cleared on
 * disk here (the previous-pid list with it), so a recycled pid cannot re-link
 * to a config whose engine is down. The route calls it on mount and the
 * summary calls it per read, making re-attach independent of the card opening.
 */
export async function relinkStoredProviders(localInfer, stored) {
    const recorded = stored.providers.filter((provider) => provider.launch !== undefined);
    if (recorded.length === 0)
        return stored.providers;
    const outcomes = await localInfer.reLinkProviders(recorded.map((provider) => ({ id: provider.id, record: provider.launch })));
    if (!recorded.some((provider) => outcomes[provider.id] === 'dead')) {
        return stored.providers;
    }
    const providers = stored.providers.map((provider) => {
        if (provider.launch === undefined || outcomes[provider.id] !== 'dead') {
            return provider;
        }
        // Rebuild the dead entry without the launch key, so the record (including
        // the previous-pid list) is gone from the file, not just ignored.
        return {
            id: provider.id,
            engine: provider.engine,
            config: provider.config,
            platform: provider.platform,
        };
    });
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
    return providers;
}
/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, the meter model the
 * service's estimate prices, and the warning model the service's guideline
 * engine fires. The estimate is the single source the meter and the verdict
 * banner agree on, and the guideline results are the single source the red
 * banner and the inline warnings agree on.
 */
export async function buildSummary(localInfer, request) {
    const stored = readConfig();
    const engineId = request?.engine ?? stored.engine;
    // ENGINES is a known non-empty constant, so the fallback is always defined.
    const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0];
    // The Model Directory field defaults to the plugin's model download
    // directory (~/.dsh/models, created when absent), so the card always
    // seeds a real path the deploy step can target. A stored or requested
    // directory that is a non-blank string wins over the default.
    const modelDirectory = localInfer.defaultModelDirectory();
    const rawConfig = request?.config ?? stored.config;
    const config = typeof rawConfig.modelDirectory === 'string' && rawConfig.modelDirectory.trim() !== ''
        ? rawConfig
        : { ...rawConfig, modelDirectory };
    const modelDir = typeof config.modelDirectory === 'string' ? config.modelDirectory : modelDirectory;
    const hardware = await localInfer.detectHardware();
    // The model value the card carries maps onto the VramModel registry key the
    // estimator prices: a default-model selection is already a registry key, a
    // directory-scan selection is an artifact file name the default list maps
    // to its registry key, and a missing value falls back to the engine's first
    // default model. Pricing the resolved key is what keeps the meter from
    // reading as not-measured (an empty chart) on a scanned model.
    const modelId = resolveModelRegistryId(engine.id, config.model);
    const pricedConfig = { ...config, model: modelId };
    // Resolve the starting config over the registered presets and the engine's
    // parameter surface, so the estimate and the model-aware guidelines price a
    // sane budget (the preset's kvDtype and max-context) rather than a bare
    // config that names no KV format. The resolved config carries the explicit
    // values the user set over the preset defaults, and the engine's first
    // default model when the user named none. The engine id rides into both
    // entry points: the estimate's OS-reserve resolution runs the plugin-
    // launched check against it, and the model-aware guidelines price the same
    // usable budget the meter does.
    const defaults = await localInfer.resolveDefaults(engine.id, modelId, hardware, pricedConfig);
    const estimate = await localInfer.estimate(defaults.config, hardware, engine.id);
    const guidelineResults = await localInfer.guidelines(defaults.config, hardware, engine.id);
    // The directory scan lists the model files the selected engine can serve
    // straight from the model directory, so the card's Model dropdown offers
    // them beside the defaults. A missing directory reads as an empty list.
    const modelFiles = modelEntriesForEngine(localInfer.listModelDirectory(modelDir), engine.id);
    // The model status checks the selected model against the model directory
    // and probes the hf CLI, so the card shows its Download row (or the URL
    // row) only while the model is absent.
    const entry = defaultModelFor(engine.id, modelId);
    let modelStatus = null;
    if (entry !== undefined) {
        const present = existsSync(modelArtifactPath(entry, modelDir));
        const hfCli = (await localInfer.hfCliAvailable()) !== null;
        modelStatus = {
            modelId: entry.modelId,
            label: entry.label,
            url: entry.url,
            present,
            hfCli,
            downloadCommand: hfDownloadCommand(entry, modelDir),
        };
    }
    // The chat-template status checks the selected template against the model
    // directory and probes the hf CLI, so the card auto-downloads an absent
    // template (and the System dependencies box shows the download command when
    // the CLI is missing). Only HF repo references are downloadable; a local
    // path or an empty template reads as null.
    const chatTemplateValue = typeof config.chatTemplate === 'string' ? config.chatTemplate : '';
    let chatTemplateStatus = null;
    if (isHfRepoReference(chatTemplateValue)) {
        const present = existsSync(join(modelDir, CHAT_TEMPLATE_FILE));
        const hfCli = (await localInfer.hfCliAvailable()) !== null;
        chatTemplateStatus = {
            repo: chatTemplateValue,
            label: chatTemplateLabel(chatTemplateValue),
            present,
            hfCli,
            downloadCommand: hfChatTemplateCommand(chatTemplateValue, modelDir),
        };
    }
    // The restart re-link: a provider entry whose launch record names a still-
    // running engine (the DSH that launched it died, and the engine re-parented
    // to init) is re-adopted as plugin-launched, so its status dot reads as
    // running for its model and the OS-reserve resolver keeps the default. A
    // record whose engine is dead is cleared (the previous-pid list with it),
    // so a recycled pid cannot re-link to a config whose engine is down. The
    // adopted engines also get a liveness watcher, so a later pkill settles the
    // stored state without waiting for another summary read.
    const linkedProviders = await relinkStoredProviders(localInfer, stored);
    // The provider list the card renders as collapsed entries: each saved
    // config's engine and model feed the detector, which resolves the running-
    // state its status dot paints. A provider the detector cannot tie to a
    // confirmed model reads as unsure, so the dot never overstates a live
    // engine. The config rides into the detector so the signature prices the
    // provider's own build mode and port, not the adapter's default-port guess.
    const providerRefs = linkedProviders.map((provider) => {
        const model = typeof provider.config.model === 'string' ? provider.config.model : undefined;
        // exactOptionalPropertyTypes: include the model key only when it is a
        // string, so a config that names no model never writes `undefined`.
        return model !== undefined
            ? { id: provider.id, engine: provider.engine, model, config: provider.config }
            : { id: provider.id, engine: provider.engine, config: provider.config };
    });
    const providerStatuses = providerRefs.length > 0 ? await localInfer.providerStatuses(providerRefs) : {};
    const providers = linkedProviders.map((provider) => ({
        id: provider.id,
        engine: provider.engine,
        model: typeof provider.config.model === 'string' ? provider.config.model : '',
        status: providerStatuses[provider.id] ?? 'unsure',
        config: provider.config,
        platform: provider.platform,
    }));
    // The "unsure" banner: shown when no provider is confirmed running but at
    // least one reads as unsure (a foreign engine the detector saw but could
    // not tie to a model, or a busy card). The banner offers bash kill commands
    // for the engine processes the detector saw holding VRAM, so the user can
    // stop a provider launched in another session.
    const anyRunning = providers.some((p) => p.status === 'running');
    const anyUnsure = providers.some((p) => p.status === 'unsure');
    const unsureBanner = !anyRunning && anyUnsure
        ? {
            message: 'Unable to link to a provider (it may have been launched in another session). \n To stop, run:',
            killCommands: await localInfer.unsureBannerKillCommands(),
        }
        : null;
    // The registered flag tells the card whether the current config's provider
    // and model are already in the DSH settings, so the Remove button shows
    // only when there is something to remove. A profile without the settings
    // seam (a host that predates the typert remote) or a host without the
    // engine adapter registered reads as unregistered.
    let registered = false;
    try {
        const regAdapter = resolveAdapter(localInfer, engine.id);
        const regPlan = regAdapter.renderLaunch(config, hardware);
        const regRow = resolveModelRow(regAdapter, regPlan, config);
        const regEntry = buildModelEntry(regPlan, regRow);
        registered = await localInfer.modelIsRegistered(regEntry.providerId, regRow.id);
    }
    catch {
        // A missing adapter, a missing settings seam, or a refused read all
        // read as unregistered, which hides the Remove button (a no-op removal).
    }
    return {
        engines: ENGINES.map((entry) => {
            // The platform defaults ride the engine entry so the card's Engine
            // platform section seeds the build-command and docker-tag placeholders
            // from the same data the deploy step consumes.
            const defaults = enginePlatformDefaults(entry.id);
            return {
                id: entry.id,
                label: entry.label,
                supports: entry.supports,
                ...(defaults.defaultBuildCommand !== undefined
                    ? { defaultBuildCommand: defaults.defaultBuildCommand }
                    : {}),
                ...(defaults.defaultDockerTag !== undefined
                    ? { defaultDockerTag: defaults.defaultDockerTag }
                    : {}),
            };
        }),
        models: localInfer.registeredVramModels().map((model) => ({ id: model.id, source: model.source })),
        hardware,
        engineId: engine.id,
        // The hardware profile prices the form's hardware-dependent controls (the
        // host-KV slider cap), so the render model and the meter agree on the
        // machine they run on.
        formModel: renderForm(engine.parameters, config, hardware),
        meterModel: renderMeter(estimate.breakdown, estimate.verdict, hardware.gpu?.vramGiB ?? 0, estimate.source, estimate.reserveSource, 
        // The "Unknown Engine(s)" readout shows the VRAM the detector's foreign
        // engine programs are holding: the OS-reserve segment is the GPU's used
        // VRAM when a foreign engine is detected, so the readout names the
        // footprint a provider launched in another session is eating off the
        // card. Absent when no provider reads as unsure.
        anyUnsure ? { bytes: estimate.breakdown.reserve } : null),
        verdict: estimate.verdict,
        warningsModel: renderWarnings(guidelineResults),
        config,
        platformConfigs: stored.platform,
        defaults: { config: defaults.config, provenance: defaults.provenance },
        modelDirectory,
        modelDefaults: defaultModelsForEngine(engine.id).map((entry) => ({
            id: entry.modelId,
            label: entry.label,
            url: entry.url,
        })),
        modelStatus,
        chatTemplateStatus,
        modelFiles,
        showHelp: stored.showHelp,
        providers,
        logPath: stored.logPath,
        lastLogs: stored.lastLogs,
        unsureBanner,
        registered,
    };
}
/**
 * RouteError is a route failure that carries its own HTTP status, so the
 * handlers map the domain answer (a gate that is off, an unsupported build
 * mode) to a status the card can read instead of a blanket 500.
 */
export class RouteError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = 'RouteError';
        this.status = status;
    }
}
/**
 * The route's view of which engine platform configs are registered with the
 * service, keyed by engine id. The service registry is the single source the
 * launch step reads, so the route keeps it in sync with the stored config:
 * on route registration, after every save, and when a launch request carries
 * a platform override. A disposer is tracked per engine, so an engine whose
 * stored config is cleared is unregistered rather than left stale.
 */
const platformDisposers = new Map();
/**
 * setPlatformConfig registers one engine's platform config with the service,
 * replacing any stored entry. A config with no fields is read as "no platform
 * config", which unregisters the engine so the deploy step falls back to the
 * adapter's default source and cache directory.
 */
function setPlatformConfig(localInfer, engineId, config) {
    platformDisposers.get(engineId)?.();
    platformDisposers.delete(engineId);
    if (config === undefined) {
        return;
    }
    if (config.engineDirectory === undefined &&
        config.engineFork === undefined &&
        config.buildCommands === undefined &&
        config.dockerTag === undefined) {
        return;
    }
    const platform = { engineId, ...config };
    platformDisposers.set(engineId, localInfer.registerEnginePlatformConfig(platform));
}
/**
 * syncPlatformConfigs re-syncs the service registry with the stored platform
 * map: it registers (or re-registers) every engine that carries a config, and
 * unregisters every engine that no longer does, so a launch always reads the
 * platform config the user last saved.
 */
function syncPlatformConfigs(localInfer, stored) {
    const wanted = stored.platform;
    for (const engineId of [...platformDisposers.keys()]) {
        if (wanted[engineId] === undefined) {
            setPlatformConfig(localInfer, engineId, undefined);
        }
    }
    for (const [engineId, config] of Object.entries(wanted)) {
        setPlatformConfig(localInfer, engineId, config);
    }
}
/**
 * resolveBuildMode picks the deploy mode the dep plan prices: the config's
 * buildMode when the selected engine supports it, else the engine's default
 * (local when the engine can build locally, docker when it cannot). The
 * docker-not-installed guideline reads this same value, so the panel and the
 * warning never disagree about the mode.
 */
export function resolveBuildMode(engine, config) {
    const defaultMode = engine.supports.local ? 'local' : 'docker';
    const requested = typeof config.buildMode === 'string' ? config.buildMode : undefined;
    if ((requested === 'docker' || requested === 'local') && engine.supports[requested]) {
        return requested;
    }
    return defaultMode;
}
/**
 * buildDeps assembles the deps panel read model for one engine and config:
 * the detected hardware (with its package manager), the dep plan the service
 * resolves, the per-dep statuses, the copy/paste install string, and the
 * Play/Run trust gate the stored config carries.
 */
export async function buildDeps(localInfer, request) {
    const stored = readConfig();
    const engineId = request?.engine ?? stored.engine;
    const config = request?.config ?? stored.config;
    // ENGINES is a known non-empty constant, so the fallback is always defined.
    const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0];
    const buildMode = resolveBuildMode(engine, config);
    const hardware = await localInfer.detectHardware();
    const deps = await localInfer.deps(engine.id, buildMode, hardware);
    const checks = await checkDeps(deps, hardware);
    // The chat-template row: when a selected template is an HF repo reference
    // and its file is not in the model directory, the System dependencies box
    // shows the download command (the auto-download's fallback when the CLI is
    // missing or the fetch failed). A present template, a local path, or no
    // template leaves the row off.
    const modelDirectory = localInfer.defaultModelDirectory();
    const rawModelDir = config.modelDirectory;
    const modelDir = typeof rawModelDir === 'string' && rawModelDir.trim() !== '' ? rawModelDir : modelDirectory;
    const chatTemplateValue = typeof config.chatTemplate === 'string' ? config.chatTemplate : '';
    let chatTemplate;
    if (isHfRepoReference(chatTemplateValue) && !existsSync(join(modelDir, CHAT_TEMPLATE_FILE))) {
        chatTemplate = {
            repo: chatTemplateValue,
            present: false,
            hfCli: (await localInfer.hfCliAvailable()) !== null,
            downloadCommand: hfChatTemplateCommand(chatTemplateValue, modelDir),
        };
    }
    // exactOptionalPropertyTypes: the chat-template row only lands while a
    // selected template is missing, so the key is included conditionally.
    const depsInput = {
        engineId: engine.id,
        buildMode,
        packageManager: hardware.packageManager ?? null,
        checks,
        installString: renderInstallString(deps, hardware),
        runAllowed: stored.allowRunDeps,
    };
    if (chatTemplate !== undefined) {
        depsInput.chatTemplate = chatTemplate;
    }
    return renderDeps(depsInput);
}
/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 */
export async function runInstallFor(localInfer, request) {
    if (readConfig().allowRunDeps !== true) {
        throw new RouteError(409, 'one-click install is not allowed; copy the install string instead');
    }
    const model = await buildDeps(localInfer, request);
    const hardware = await localInfer.detectHardware();
    const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware);
    const deps = model.deps.map((dep) => {
        const entry = result.results.find((entry) => entry.id === dep.id);
        return entry === undefined ? dep : { ...dep, status: entry.status };
    });
    return {
        result,
        deps: { ...model, deps, allSatisfied: result.ok },
    };
}
/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory against the request, the
 * stored config, and the plugin's default model directory in that order, and
 * runs the download through the service.
 */
export async function downloadFor(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const modelId = request.model ?? (typeof stored.config.model === 'string' ? stored.config.model : '');
    const entry = defaultModelFor(engineId, modelId);
    if (entry === undefined) {
        throw new RouteError(404, `no default model is registered for "${engineId}/${modelId}"`);
    }
    const storedDir = stored.config.modelDirectory;
    const directory = typeof request.directory === 'string' && request.directory.trim() !== ''
        ? request.directory
        : typeof storedDir === 'string' && storedDir.trim() !== ''
            ? storedDir
            : localInfer.defaultModelDirectory();
    return localInfer.downloadModel(entry, directory);
}
/**
 * chatTemplateDownloadFor runs the hf CLI download for the request's chat
 * template: it resolves the template repo reference from the request or the
 * stored config's chatTemplate (a 400 when neither names an HF repo
 * reference), resolves the directory against the request, the stored config,
 * and the plugin's default model directory in that order, and runs the
 * download through the service.
 */
export async function chatTemplateDownloadFor(localInfer, request) {
    const stored = readConfig();
    let template = typeof request.template === 'string' ? request.template : '';
    if (template.trim() === '') {
        template = typeof stored.config.chatTemplate === 'string' ? stored.config.chatTemplate : '';
    }
    if (!isHfRepoReference(template)) {
        throw new RouteError(400, `the chat template must be an HF repo reference, got "${template || '(none)'}"`);
    }
    const storedDir = stored.config.modelDirectory;
    const directory = typeof request.directory === 'string' && request.directory.trim() !== ''
        ? request.directory
        : typeof storedDir === 'string' && storedDir.trim() !== ''
            ? storedDir
            : localInfer.defaultModelDirectory();
    return localInfer.downloadChatTemplate(template, directory);
}
/**
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
function resolveAdapter(localInfer, engineId) {
    const adapter = localInfer.registeredEngines().find((engine) => engine.id === engineId);
    if (adapter === undefined) {
        throw new RouteError(404, `no engine adapter is registered for "${engineId}"`);
    }
    return adapter;
}
/**
 * launchCommandNote renders the plan's child-process launch line for the
 * card's Logs section: the core formatter's command under a [local-infer]
 * launch prefix, newline-terminated. A plan that names no command (a bare
 * docker plan with no argv) has no note, and the run logs stay as they are.
 */
function launchCommandNote(plan) {
    const command = formatLaunchCommand(plan);
    if (command === undefined)
        return undefined;
    return `[local-infer] launch: ${command}\n`;
}
/**
 * applyComposeArgs seeds a compose plan's compose arguments from the stored
 * platform config (the card's docker-tag field for a compose engine, e.g.
 * `--profile single`), so the up line the deploy runs and the down line the
 * stop runs both select the profile the user named. A compose plan with no
 * stored docker-tag keeps the engine's default profile; a non-compose plan is
 * untouched.
 */
function applyComposeArgs(plan, localInfer, engineId) {
    if (plan.kind !== 'compose')
        return;
    const platform = localInfer.enginePlatformConfig(engineId);
    if (platform?.dockerTag !== undefined) {
        plan.composeArgs = platform.dockerTag;
    }
}
/**
 * persistStoredLogs overwrites the stored last-run logs (the card's Logs
 * section shows them after a reload) and leaves every other stored field as
 * the launch reads it.
 */
function persistStoredLogs(logs) {
    const stored = readConfig();
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, stored.providers, stored.logPath, logs);
}
/**
 * launchEngine renders the plan the registered adapter produces for the config
 * and the detected hardware, then runs the service's launch entry point
 * (deploy, then the health poll). The detail the launch returns names the
 * broken step when the engine does not come up. The launch line (the engine
 * binary and its arguments) leads the run logs the card's Logs section and
 * the log file carry, so a broken setup diagnoses against the exact child
 * process the launch started. The launch step persists the
 * launch record (the engine pid, start time, launch arguments, and the DSH
 * process pid that launched it) on the request's provider entry, so a DSH
 * restart can re-link a surviving engine to its config.
 */
export async function launchEngine(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const config = request.config ?? stored.config;
    const adapter = resolveAdapter(localInfer, engineId);
    const hardware = await localInfer.detectHardware();
    // Register the request's platform override (the card's unsaved Engine
    // Directory / Engine Fork edits) so the service's launch resolves it against
    // the adapter's deploy step. An absent platform keeps the stored entry,
    // which the save route and route registration already synced.
    if (request.platform !== undefined) {
        setPlatformConfig(localInfer, engineId, request.platform);
    }
    const plan = adapter.renderLaunch(config, hardware);
    applyComposeArgs(plan, localInfer, engineId);
    const commandNote = launchCommandNote(plan);
    if (commandNote !== undefined) {
        // Persist before the deploy starts: a slow or hung launch keeps the
        // command readable in the Logs section across a card reload, where the
        // engine output has not landed yet.
        persistStoredLogs(commandNote);
    }
    const result = await localInfer.launch(plan);
    if (commandNote !== undefined) {
        // A deploy that failed before the engine printed anything still reports
        // the command it tried to run.
        result.logs = commandNote + (result.logs ?? '');
    }
    persistLaunchLogs(result, engineId, config);
    persistLaunchRecord(result, engineId, config, request.providerId);
    return result;
}
/**
 * findLaunchTarget resolves the stored provider entry a launch or stop
 * targets: the entry the request names by id, or (an id the card does not
 * send, a launch of the active config) the stored entry with the same engine
 * and model. A launch with no resolvable entry persists no record, which
 * reads as "no provider config to re-link" after a restart.
 */
function findLaunchTarget(stored, engineId, providerId, config) {
    if (providerId !== undefined) {
        const byId = stored.providers.find((entry) => entry.id === providerId);
        if (byId !== undefined)
            return byId;
    }
    const model = typeof config.model === 'string' ? config.model : undefined;
    if (model === undefined)
        return undefined;
    return stored.providers.find((entry) => entry.engine === engineId &&
        (typeof entry.config.model === 'string' ? entry.config.model : undefined) === model);
}
/**
 * persistLaunchRecord stores a launch's record on the target provider entry:
 * the engine pid the deploy step started, the start time, the plan's argv,
 * the DSH process pid the launch ran under (only when it identified as DSH),
 * and the previous-pid list the re-link rule prices (the entry's own list
 * plus the current DSH pid, capped by the core builder). A launch whose
 * deploy started no tracked process (a compose up) persists nothing, and a
 * launch with no resolvable entry persists nothing.
 */
function persistLaunchRecord(result, engineId, config, providerId) {
    if (result.pid === undefined)
        return;
    const stored = readConfig();
    const target = findLaunchTarget(stored, engineId, providerId, config);
    if (target === undefined)
        return;
    const record = launchRecordFromPlan(result.plan, result.pid, result.parentPid, target.launch?.previousPids ?? []);
    const providers = stored.providers.map((entry) => entry.id === target.id ? { ...entry, launch: record } : entry);
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
}
/**
 * clearLaunchRecord removes the target provider entry's launch record (the
 * engine pid and the previous-pid list with it), so a stopped engine's pid
 * cannot be re-linked to its config by a recycled pid. A stop with no
 * resolvable entry, or an entry that carries no record, is a no-op.
 */
function clearLaunchRecord(engineId, config, providerId) {
    const stored = readConfig();
    const target = findLaunchTarget(stored, engineId, providerId, config);
    if (target === undefined || target.launch === undefined)
        return;
    const providers = stored.providers.map((entry) => {
        if (entry.id !== target.id)
            return entry;
        // Rebuild the entry without the launch key, so the record (including the
        // previous-pid list) is gone from the file, not just ignored.
        return { id: entry.id, engine: entry.engine, config: entry.config, platform: entry.platform };
    });
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
}
/**
 * handleEngineDeath persists a provider entry's state when its engine process
 * dies outside the plugin's stop path: a crash, a pkill of a plugin-launched
 * child seen through the service's exit watch, or the poll-detected exit of a
 * process adopted after a DSH restart. The entry whose launch record names the
 * dead pid (or the dead engine-and-port, when the report carries no pid match)
 * has its record cleared, so a restart never re-links a dead pid, and the exit
 * line lands in the card's last-run logs beside the engine's own output. An
 * event that matches no entry carrying a record (a stop the route already
 * cleared, an engine the plugin never tracked) is a no-op, which keeps an
 * expected stop quiet.
 */
export function handleEngineDeath(event) {
    const stored = readConfig();
    let matched = false;
    const providers = stored.providers.map((entry) => {
        const record = entry.launch;
        if (record === undefined)
            return entry;
        const byPid = event.pid !== undefined && record.pid === event.pid;
        const byEnginePort = event.port !== undefined && record.engineId === entry.engine && record.port === event.port;
        if (!byPid && !byEnginePort)
            return entry;
        matched = true;
        // Rebuild the entry without the launch key, so the record (including the
        // previous-pid list) is gone from the file, not just ignored.
        return { id: entry.id, engine: entry.engine, config: entry.config, platform: entry.platform };
    });
    if (!matched)
        return;
    const signalNote = event.signal !== null && event.signal !== undefined
        ? ` on signal ${event.signal}`
        : ` with exit code ${event.code}`;
    const note = `[local-infer] engine ${event.engineId}` +
        `${event.port !== undefined ? ` (port ${event.port})` : ''}` +
        ` pid ${event.pid ?? 'unknown'} exited${signalNote}` +
        `${event.detail !== undefined ? `: ${event.detail}` : ''}\n`;
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, 
    // Keep the last-run tail bounded, the same rule the launch logs cap uses.
    (stored.lastLogs + note).slice(-65536));
}
/**
 * persistLaunchLogs stores a launch's captured output as the last run and
 * writes it to the configured log file. The log file is only written when the
 * run produced output and the log location is set; the last-run logs are always
 * persisted (an empty string clears a stale run) so the card's Logs section
 * shows the previous run after a reload.
 */
export function persistLaunchLogs(result, engineId, config) {
    const stored = readConfig();
    const logs = result.logs ?? '';
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, stored.providers, stored.logPath, logs);
    if (logs === '') {
        return;
    }
    const modelId = typeof config.model === 'string' ? config.model : undefined;
    const logPath = resolveLogPath(stored.logPath, engineId, modelId, new Date(), homedir());
    try {
        mkdirSync(dirname(logPath), { recursive: true });
        writeFileSync(logPath, logs);
    }
    catch {
        // A log file that cannot be written (a read-only dir, a bad path) must not
        // fail the launch; the in-memory last-run logs still reach the card.
    }
}
/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started. The
 * stop then clears the target entry's launch record (the engine pid and the
 * previous-pid list with it), so a recycled pid cannot re-link an engine the
 * user just stopped.
 */
export async function stopEngine(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const config = request.config ?? stored.config;
    const adapter = resolveAdapter(localInfer, engineId);
    const hardware = await localInfer.detectHardware();
    const plan = adapter.renderLaunch(config, hardware);
    applyComposeArgs(plan, localInfer, engineId);
    await localInfer.stop(plan);
    clearLaunchRecord(engineId, config, request.providerId);
}
/**
 * resolveEngineDirectory picks the checkout the Get step syncs: the Engine
 * Directory override when it names a path, else a per-engine folder inside
 * the model directory (the default model directory, or the config's
 * override), so a Get with no override still has a real place to live.
 */
function resolveEngineDirectory(localInfer, config, engineId, platform) {
    const override = platform?.engineDirectory;
    if (override !== undefined && override.trim() !== '') {
        return override;
    }
    const rawModelDir = config.modelDirectory;
    const modelDir = typeof rawModelDir === 'string' && rawModelDir.trim() !== ''
        ? rawModelDir
        : localInfer.defaultModelDirectory();
    return join(modelDir, engineId);
}
/**
 * getEngine is the Get step: it syncs the engine checkout (clone the git
 * repo, or the fork when the platform entry provides one; fetch and rebase
 * a clean checkout; abort with a Logs alert when the checkout has local
 * changes), runs the system dependency plan, and runs the engine's build
 * steps. Every command and its output streams through log as it lands, so
 * the card appends it to the Logs section live. The dependency install only
 * runs while the Play/Run trust gate is on; with the gate off the deps are
 * re-checked and a missing one aborts the step with the copy/paste note.
 */
export async function getEngine(localInfer, request, log, host = nodeLifecycleHost) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const config = request.config ?? stored.config;
    // ENGINES is a known non-empty constant, so the fallback is always defined.
    const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0];
    // Register the request's platform override the same way launchEngine does,
    // so the next launch reads the Engine Directory / Engine Fork the Get used.
    if (request.platform !== undefined) {
        setPlatformConfig(localInfer, engineId, request.platform);
    }
    const platform = request.platform ?? stored.platform[engineId];
    const directory = resolveEngineDirectory(localInfer, config, engineId, platform);
    const fork = platform?.engineFork;
    log(`get ${engineId} in ${directory}\n`);
    const sync = await syncEngineRepo(host, { engineId, directory, ...(fork !== undefined && fork.trim() !== '' ? { fork } : {}) }, log);
    if (!sync.ok) {
        // A dirty checkout already alerted in the sync step; any other failure
        // names its step here.
        if (sync.aborted !== true && sync.detail !== undefined) {
            log(`!! ${sync.detail}\n`);
        }
        return { ok: false, ...(sync.detail !== undefined ? { detail: sync.detail } : {}) };
    }
    const hardware = await localInfer.detectHardware();
    const buildMode = resolveBuildMode(engine, config);
    log(`system dependencies (${buildMode})\n`);
    if (stored.allowRunDeps === true) {
        const result = await localInfer.runInstall(engineId, buildMode, hardware);
        for (const entry of result.results) {
            log(`  ${entry.id}: ${entry.status}${entry.detail !== undefined ? ` (${entry.detail})` : ''}\n`);
        }
        if (!result.ok) {
            log('!! a system dependency install failed; copy the install string from the panel\n');
            return { ok: false, detail: 'a system dependency install failed' };
        }
    }
    else {
        const deps = await localInfer.deps(engineId, buildMode, hardware);
        const checks = await checkDeps(deps, hardware);
        let missing = false;
        for (const check of checks) {
            log(`  ${check.dep.id}: ${check.status}\n`);
            if (check.status !== 'satisfied')
                missing = true;
        }
        if (missing) {
            log('!! a system dependency is missing and one-click install is off; copy the install string from the panel\n');
            return { ok: false, detail: 'a system dependency is missing' };
        }
    }
    const build = await buildEngineRepo(host, engineId, directory, log);
    if (!build.ok) {
        if (build.detail !== undefined) {
            log(`!! ${build.detail}\n`);
        }
        return { ok: false, ...(build.detail !== undefined ? { detail: build.detail } : {}) };
    }
    log('get complete\n');
    return { ok: true };
}
/**
 * persistGetLogs appends one Get run's streamed output to the stored last-
 * run logs (the card's Logs section shows it after a reload) and writes no
 * log file: the launch step owns the per-run files. The tail rule matches
 * the launch logs' cap, so a long build cannot grow the config without
 * bound.
 */
function persistGetLogs(output) {
    if (output === '')
        return;
    const stored = readConfig();
    const joined = `${stored.lastLogs}${stored.lastLogs === '' ? '' : '\n'}${output}`;
    writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, stored.providers, stored.logPath, joined.slice(-65536));
}
/**
 * resolveContextWindow picks the context window the registrar publishes: the
 * config's maxContext when it names one, else the native ceiling of the
 * VramModel the config resolves to (the named model, or the single
 * registered model), else the 32768 spec default. The DSH contextWindow must
 * not promise a context the engine cannot serve, so the ceiling is the
 * model's own, not an optimistic number.
 */
export function resolveContextWindow(config, models) {
    const configured = config.maxContext;
    if (typeof configured === 'number' && configured > 0) {
        return configured;
    }
    let model;
    if (typeof config.model === 'string') {
        model = models.find((entry) => entry.id === config.model);
    }
    else if (models.length === 1) {
        model = models[0];
    }
    return model?.nativeMaxContext ?? 32768;
}
/**
 * resolveModelRow picks the model row the registrar publishes for an engine
 * and config: the adapter's modelRef (the id the engine serves on its
 * OpenAI endpoint) when it declares one, else the plan's model id, else the
 * engine id. The display name follows the same fall-through.
 */
function resolveModelRow(adapter, plan, config) {
    const ref = adapter.modelRef?.(config);
    const id = ref?.id ?? plan.modelId ?? adapter.id;
    return { id, name: ref?.name ?? id, contextWindow: 0 };
}
/**
 * registerFor renders the plan through the registered adapter, resolves the
 * model row and the context window, and runs the service's register entry
 * point, which upserts the provider and model through the settings seam.
 * The result carries the entry the registrar wrote, so the card names the
 * model it published.
 */
export async function registerFor(localInfer, request) {
    const stored = readConfig();
    const engineId = request?.engine ?? stored.engine;
    const config = request?.config ?? stored.config;
    const adapter = resolveAdapter(localInfer, engineId);
    const hardware = await localInfer.detectHardware();
    const plan = adapter.renderLaunch(config, hardware);
    const row = resolveModelRow(adapter, plan, config);
    row.contextWindow = resolveContextWindow(config, localInfer.registeredVramModels());
    // The vision flag publishes the Image input type on the DSH model row, so a
    // vision engine advertises ['text', 'image'] and a text-only engine
    // ['text']. The registrar copies it into the entry it writes.
    row.input = config.vision === true ? ['text', 'image'] : ['text'];
    const options = request?.agentDefault === true ? { agentDefault: true } : undefined;
    return localInfer.registerModel(plan, row, options);
}
/**
 * syncRegisteredModel re-runs the registration for a saved config when the
 * model is already registered in the DSH settings, so the registered model's
 * input types (the vision flag) stay in step with the saved config. A model
 * that is not registered (a fresh save) is a no-op, and a profile without the
 * settings seam throws, which the save route catches and swallows so the save
 * itself never fails on a sync that cannot run.
 */
export async function syncRegisteredModel(localInfer, engine, config) {
    const adapter = resolveAdapter(localInfer, engine);
    const hardware = await localInfer.detectHardware();
    const plan = adapter.renderLaunch(config, hardware);
    const row = resolveModelRow(adapter, plan, config);
    const buildMode = plan.kind === 'docker' ? 'docker' : 'local';
    const providerId = providerIdFor(adapter.id, row.id, buildMode);
    if (await localInfer.modelIsRegistered(providerId, row.id)) {
        await registerFor(localInfer, { engine, config });
    }
}
/**
 * unregisterFor runs the service's removeModel entry point for the engine's
 * provider and the model row the register step resolved, so the removal
 * targets the exact entry the registration wrote.
 */
export async function unregisterFor(localInfer, request) {
    const stored = readConfig();
    const engineId = request?.engine ?? stored.engine;
    const config = request?.config ?? stored.config;
    const adapter = resolveAdapter(localInfer, engineId);
    const hardware = await localInfer.detectHardware();
    const plan = adapter.renderLaunch(config, hardware);
    const row = resolveModelRow(adapter, plan, config);
    // The removal must target the exact entry the register step wrote, so the
    // provider id is computed through buildModelEntry (the same function the
    // register step uses) rather than a parallel providerIdFor call, which
    // could drift if plan.engineId and adapter.id ever diverge.
    const entry = buildModelEntry(plan, row);
    await localInfer.removeModel(entry.providerId, row.id);
    return { removed: true };
}
/**
 * registerLocalInferRoute registers the summary, save, deps, install, get,
 * launch, stop, register, and unregister routes on the web server and holds
 * them by an effect, so a bundle switch off removes them before the next
 * switch on re-registers. The scoped context carries the webServer; the
 * localInfer service is passed in because the scope only injects what it
 * names. The optional getHost is the lifecycle host the Get route's git and
 * build steps run through; it defaults to the node host, and a test injects
 * a stub so the route never clones a real repo in CI.
 */
export function registerLocalInferRoute(scope, localInfer, getHost) {
    const summary = async (url) => {
        const engineParam = url.searchParams.get('engine');
        const configParam = url.searchParams.get('config');
        let config;
        if (configParam !== null) {
            try {
                config = JSON.parse(configParam);
            }
            catch {
                config = undefined;
            }
        }
        // exactOptionalPropertyTypes: build the request object with only the keys
        // that are present, so an absent value never writes `undefined`.
        const request = {};
        if (engineParam !== null) {
            request.engine = engineParam;
        }
        if (config !== undefined) {
            request.config = config;
        }
        return buildSummary(localInfer, request);
    };
    const route = {
        name: 'local-infer-config',
        kind: 'exact',
        path: '/local-infer/summary',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method === 'GET') {
                try {
                    send(200, await summary(new URL(req.url, 'http://localhost')));
                }
                catch (error) {
                    send(500, { error: String(error?.message ?? error) });
                }
                return;
            }
            res.writeHead(405).end();
        },
    };
    const save = {
        name: 'local-infer-save',
        kind: 'exact',
        path: '/local-infer/save',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'config payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const engine = typeof body.engine === 'string' ? body.engine : 'ninfer';
                const config = body.config && typeof body.config === 'object' ? body.config : {};
                const allowRunDeps = typeof body.allowRunDeps === 'boolean' ? body.allowRunDeps : false;
                const platform = parsePlatformConfigs(body.platform);
                // A body that predates the key keeps the descriptions visible.
                const showHelp = typeof body.showHelp === 'boolean' ? body.showHelp : true;
                const providerId = typeof body.id === 'string' && body.id.trim() !== '' ? body.id : undefined;
                // A body that omits the log location (or sends a blank one) keeps the
                // stored template, so an unsaved edit never wipes a custom path.
                const logPath = typeof body.logPath === 'string' && body.logPath !== ''
                    ? body.logPath
                    : readConfig().logPath;
                // Save upserts a provider entry: an id updates the stored entry in
                // place, an absent id mints a new id and prepends the entry, so a Save
                // always adds (or refreshes) a card entry at the top of the list. The
                // provider's platform config is the per-engine entry the deploy step
                // reads, so a provider never carries a field it cannot price. A save
                // that updates an entry in place carries the entry's launch record
                // over, so editing a running provider's config never drops the record
                // the restart re-link prices.
                const stored = readConfig();
                const provider = {
                    id: providerId ?? newProviderId(),
                    engine,
                    config,
                    platform: platform[engine] ?? {},
                };
                if (providerId !== undefined) {
                    const existing = stored.providers.find((entry) => entry.id === providerId);
                    if (existing?.launch !== undefined) {
                        provider.launch = existing.launch;
                    }
                }
                const providers = providerId !== undefined
                    ? stored.providers.map((entry) => (entry.id === providerId ? provider : entry))
                    : [provider, ...stored.providers];
                writeConfig(engine, config, allowRunDeps, platform, showHelp, providers, logPath);
                // Re-sync the service registry with the saved platform map, so the next
                // launch reads the platform config the user just saved.
                syncPlatformConfigs(localInfer, {
                    engine,
                    config,
                    allowRunDeps,
                    platform,
                    showHelp,
                    providers,
                    logPath,
                    lastLogs: stored.lastLogs,
                });
                // A Save on an already-registered model re-runs the registration, so
                // the DSH model row's input types (the vision flag) stay in step with
                // the config the user just saved. Best-effort: a profile without the
                // settings seam, or an engine no adapter serves, leaves the save intact.
                try {
                    await syncRegisteredModel(localInfer, engine, config);
                }
                catch {
                    // A sync that cannot run is a no-op for the save.
                }
                send(200, await buildSummary(localInfer, { engine, config }));
            }
            catch (error) {
                send(400, { error: String(error?.message ?? error) });
            }
        },
    };
    const deleteProvider = {
        name: 'local-infer-provider-delete',
        kind: 'exact',
        path: '/local-infer/provider-delete',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const id = typeof body.id === 'string' ? body.id : undefined;
                if (id === undefined) {
                    send(400, { error: 'the provider id is required' });
                    return;
                }
                // Delete removes the stored provider entry by id, keeping the rest of
                // the list and the active config intact, then re-syncs the registry so
                // a launch never reads a platform config the user just removed.
                const stored = readConfig();
                const providers = stored.providers.filter((entry) => entry.id !== id);
                writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
                syncPlatformConfigs(localInfer, stored);
                send(200, await buildSummary(localInfer));
            }
            catch (error) {
                send(400, { error: String(error?.message ?? error) });
            }
        },
    };
    const deps = {
        name: 'local-infer-deps',
        kind: 'exact',
        path: '/local-infer/deps',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'GET') {
                res.writeHead(405).end();
                return;
            }
            const url = new URL(req.url, 'http://localhost');
            const engineParam = url.searchParams.get('engine');
            const configParam = url.searchParams.get('config');
            let config;
            if (configParam !== null) {
                try {
                    config = JSON.parse(configParam);
                }
                catch {
                    config = undefined;
                }
            }
            // exactOptionalPropertyTypes: build the request object with only the
            // keys that are present, so an absent value never writes `undefined`.
            const request = {};
            if (engineParam !== null) {
                request.engine = engineParam;
            }
            if (config !== undefined) {
                request.config = config;
            }
            try {
                send(200, await buildDeps(localInfer, request));
            }
            catch (error) {
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    const install = {
        name: 'local-infer-install',
        kind: 'exact',
        path: '/local-infer/install',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'install payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const request = {};
                if (typeof body.engine === 'string') {
                    request.engine = body.engine;
                }
                if (body.config && typeof body.config === 'object') {
                    request.config = body.config;
                }
                send(200, await runInstallFor(localInfer, request));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    const download = {
        name: 'local-infer-download',
        kind: 'exact',
        path: '/local-infer/download',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'download payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const request = {};
                if (typeof body.engine === 'string') {
                    request.engine = body.engine;
                }
                if (typeof body.model === 'string') {
                    request.model = body.model;
                }
                if (typeof body.directory === 'string') {
                    request.directory = body.directory;
                }
                send(200, await downloadFor(localInfer, request));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    // The chat-template download route: the card's auto-download (and the
    // System-dependencies fallback) pulls a selected template into the model
    // directory through this route, so a picked preset works out of the box.
    const chatTemplate = {
        name: 'local-infer-chat-template',
        kind: 'exact',
        path: '/local-infer/chat-template',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'chat template payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const request = {};
                if (typeof body.engine === 'string') {
                    request.engine = body.engine;
                }
                if (typeof body.template === 'string') {
                    request.template = body.template;
                }
                if (typeof body.directory === 'string') {
                    request.directory = body.directory;
                }
                send(200, await chatTemplateDownloadFor(localInfer, request));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    // The Get route: a POST whose answer streams as plain text, so the card
    // appends the git sync, the dependency run, and the build output to its
    // Logs section as it lands. The full run persists as the last-run logs.
    const get = {
        name: 'local-infer-get',
        kind: 'exact',
        path: '/local-infer/get',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'get payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const request = {};
                if (typeof body.engine === 'string') {
                    request.engine = body.engine;
                }
                if (body.config && typeof body.config === 'object') {
                    request.config = body.config;
                }
                const platform = parseStoredPlatformConfig(body.platform);
                if (platform !== undefined) {
                    request.platform = platform;
                }
                res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
                let collected = '';
                const log = (text) => {
                    collected += text;
                    if (typeof res.write === 'function') {
                        res.write(text);
                    }
                };
                try {
                    await getEngine(localInfer, request, log, getHost);
                }
                catch (error) {
                    log(`!! get failed: ${String(error?.message ?? error)}\n`);
                }
                persistGetLogs(collected);
                res.end();
            }
            catch (error) {
                send(400, { error: String(error?.message ?? error) });
            }
        },
    };
    // The launch and stop routes share a POST body parser: the engine, config,
    // and platform override the plan renders from, falling back to the stored
    // config per key. The stop route ignores the platform key. `providerId`
    // names the saved provider entry the launch record (or its stop's clear)
    // targets.
    const launchRequestFromBody = (body) => {
        const request = {};
        if (typeof body.engine === 'string') {
            request.engine = body.engine;
        }
        if (body.config && typeof body.config === 'object') {
            request.config = body.config;
        }
        const platform = parseStoredPlatformConfig(body.platform);
        if (platform !== undefined) {
            request.platform = platform;
        }
        if (typeof body.providerId === 'string' && body.providerId.trim() !== '') {
            request.providerId = body.providerId;
        }
        return request;
    };
    const launch = {
        name: 'local-infer-launch',
        kind: 'exact',
        path: '/local-infer/launch',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'launch payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                send(200, await launchEngine(localInfer, launchRequestFromBody(body)));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    const stop = {
        name: 'local-infer-stop',
        kind: 'exact',
        path: '/local-infer/stop',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'stop payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                await stopEngine(localInfer, launchRequestFromBody(body));
                send(200, { stopped: true });
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    // The register and unregister routes share a body parser: the engine and
    // config the plan renders from, plus agentDefault for the register route,
    // falling back to the stored config per key.
    const registerRequestFromBody = (body) => {
        const request = {};
        if (typeof body.engine === 'string') {
            request.engine = body.engine;
        }
        if (body.config && typeof body.config === 'object') {
            request.config = body.config;
        }
        if (typeof body.agentDefault === 'boolean') {
            request.agentDefault = body.agentDefault;
        }
        return request;
    };
    const register = {
        name: 'local-infer-register',
        kind: 'exact',
        path: '/local-infer/register',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'register payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                send(200, await registerFor(localInfer, registerRequestFromBody(body)));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    const unregister = {
        name: 'local-infer-unregister',
        kind: 'exact',
        path: '/local-infer/unregister',
        handler: async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }
            try {
                const chunks = [];
                let total = 0;
                for await (const chunk of req) {
                    total += chunk.length;
                    if (total > 64 * 1024) {
                        send(413, { error: 'unregister payload too large' });
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                send(200, await unregisterFor(localInfer, registerRequestFromBody(body)));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    send(error.status, { error: error.message });
                    return;
                }
                send(500, { error: String(error?.message ?? error) });
            }
        },
    };
    scope.effect(() => {
        // Sync the service's platform-config registry with the stored config on
        // route registration, so a launch before the first save reads the
        // platform config the user last saved.
        syncPlatformConfigs(localInfer, readConfig());
        // The engine death observer: a crash, a pkill, or the poll-detected exit
        // of an adopted process clears the provider entry's launch record and
        // notes the exit in the last-run logs the moment it happens, so the card
        // and a later restart read the provider stopped rather than stale.
        localInfer.setEngineDeathObserver(handleEngineDeath);
        // The mount re-link: re-adopt a surviving engine from a stored launch
        // record and start its liveness watcher without waiting for the card to
        // open the summary route, so a DSH that restarts re-attaches its engines
        // and a pkill after the restart still settles the stored state.
        void relinkStoredProviders(localInfer, readConfig()).catch(() => undefined);
        const disposeSummary = scope.webServer.register(route);
        const disposeSave = scope.webServer.register(save);
        const disposeDeleteProvider = scope.webServer.register(deleteProvider);
        const disposeDeps = scope.webServer.register(deps);
        const disposeInstall = scope.webServer.register(install);
        const disposeDownload = scope.webServer.register(download);
        const disposeChatTemplate = scope.webServer.register(chatTemplate);
        const disposeGet = scope.webServer.register(get);
        const disposeLaunch = scope.webServer.register(launch);
        const disposeStop = scope.webServer.register(stop);
        const disposeRegister = scope.webServer.register(register);
        const disposeUnregister = scope.webServer.register(unregister);
        return () => {
            localInfer.setEngineDeathObserver(undefined);
            disposeSummary();
            disposeSave();
            disposeDeleteProvider();
            disposeDeps();
            disposeInstall();
            disposeDownload();
            disposeChatTemplate();
            disposeGet();
            disposeLaunch();
            disposeStop();
            disposeRegister();
            disposeUnregister();
        };
    }, 'local-infer: settings routes');
}
//# sourceMappingURL=route.js.map