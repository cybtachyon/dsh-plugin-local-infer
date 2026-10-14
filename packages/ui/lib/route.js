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
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { checkDeps, hfDownloadCommand, modelArtifactPath, modelEntriesForEngine, providerIdFor, renderInstallString, } from '../../core/lib/index.js';
import { defaultModelFor, defaultModelsForEngine, ENGINES, } from '../../providers/lib/index.js';
import { renderDeps } from "./deps.js";
import { renderForm } from "./form.js";
import { renderMeter } from "./meter.js";
import { renderWarnings } from "./warnings.js";
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
        return { engine: 'ninfer', config: {}, allowRunDeps: false, platform: {} };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return {
            engine: typeof parsed.engine === 'string' ? parsed.engine : 'ninfer',
            config: parsed.config && typeof parsed.config === 'object' ? parsed.config : {},
            allowRunDeps: typeof parsed.allowRunDeps === 'boolean' ? parsed.allowRunDeps : false,
            platform: parsePlatformConfigs(parsed.platform),
        };
    }
    catch {
        return { engine: 'ninfer', config: {}, allowRunDeps: false, platform: {} };
    }
}
/**
 * writeConfig persists the engine, config, trust gate, and per-engine platform
 * configs, creating the directory tree on first write.
 */
export function writeConfig(engine, config, allowRunDeps, platform) {
    const path = localInferConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ engine, config, allowRunDeps, platform: platform ?? {} }, null, 2));
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
        if (stored.engineDirectory !== undefined || stored.engineFork !== undefined) {
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
    if (stored.engineDirectory === undefined && stored.engineFork === undefined) {
        return undefined;
    }
    return stored;
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
    // The engine id rides into both entry points: the estimate's OS-reserve
    // resolution runs the plugin-launched check against it, and the
    // model-aware guidelines price the same usable budget the meter does.
    const estimate = await localInfer.estimate(config, hardware, engine.id);
    const guidelineResults = await localInfer.guidelines(config, hardware, engine.id);
    // The defaults list is the Model field's "Defaults" special case: a config
    // with no model names the engine's first default model, so the meter, the
    // form seed, and the model status all price the same starting model.
    const engineDefaults = defaultModelsForEngine(engine.id);
    const modelId = typeof config.model === 'string' ? config.model : (engineDefaults[0]?.modelId ?? engine.id);
    const defaults = await localInfer.resolveDefaults(engine.id, modelId, hardware, config);
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
    return {
        engines: ENGINES.map((entry) => ({ id: entry.id, label: entry.label, supports: entry.supports })),
        models: localInfer.registeredVramModels().map((model) => ({ id: model.id, source: model.source })),
        hardware,
        engineId: engine.id,
        formModel: renderForm(engine.parameters, config),
        meterModel: renderMeter(estimate.breakdown, estimate.verdict, hardware.gpu?.vramGiB ?? 0, estimate.source, estimate.reserveSource),
        verdict: estimate.verdict,
        warningsModel: renderWarnings(guidelineResults),
        config,
        platformConfigs: stored.platform,
        defaults: { config: defaults.config, provenance: defaults.provenance },
        modelDirectory,
        modelDefaults: engineDefaults.map((entry) => ({
            id: entry.modelId,
            label: entry.label,
            url: entry.url,
        })),
        modelStatus,
        modelFiles,
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
    if (config.engineDirectory === undefined && config.engineFork === undefined) {
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
    return renderDeps({
        engineId: engine.id,
        buildMode,
        packageManager: hardware.packageManager ?? null,
        checks,
        installString: renderInstallString(deps, hardware),
        runAllowed: stored.allowRunDeps,
    });
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
 * launchEngine renders the plan the registered adapter produces for the config
 * and the detected hardware, then runs the service's launch entry point
 * (deploy, then the health poll). The detail the launch returns names the
 * broken step when the engine does not come up.
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
    return localInfer.launch(adapter.renderLaunch(config, hardware));
}
/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started.
 */
export async function stopEngine(localInfer, request) {
    const stored = readConfig();
    const engineId = request.engine ?? stored.engine;
    const config = request.config ?? stored.config;
    const adapter = resolveAdapter(localInfer, engineId);
    const hardware = await localInfer.detectHardware();
    await localInfer.stop(adapter.renderLaunch(config, hardware));
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
    const options = request?.agentDefault === true ? { agentDefault: true } : undefined;
    return localInfer.registerModel(plan, row, options);
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
    await localInfer.removeModel(providerIdFor(adapter.id), row.id);
    return { removed: true };
}
/**
 * registerLocalInferRoute registers the summary, save, deps, install, launch,
 * stop, register, and unregister routes on the web server and holds them by
 * an effect, so a bundle switch off removes them before the next switch on
 * re-registers. The scoped context carries the webServer; the localInfer
 * service is passed in because the scope only injects what it names.
 */
export function registerLocalInferRoute(scope, localInfer) {
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
                writeConfig(engine, config, allowRunDeps, platform);
                // Re-sync the service registry with the saved platform map, so the next
                // launch reads the platform config the user just saved.
                syncPlatformConfigs(localInfer, { engine, config, allowRunDeps, platform });
                send(200, await buildSummary(localInfer, { engine, config }));
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
    // The launch and stop routes share a POST body parser: the engine, config,
    // and platform override the plan renders from, falling back to the stored
    // config per key. The stop route ignores the platform key.
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
        const disposeSummary = scope.webServer.register(route);
        const disposeSave = scope.webServer.register(save);
        const disposeDeps = scope.webServer.register(deps);
        const disposeInstall = scope.webServer.register(install);
        const disposeDownload = scope.webServer.register(download);
        const disposeLaunch = scope.webServer.register(launch);
        const disposeStop = scope.webServer.register(stop);
        const disposeRegister = scope.webServer.register(register);
        const disposeUnregister = scope.webServer.register(unregister);
        return () => {
            disposeSummary();
            disposeSave();
            disposeDeps();
            disposeInstall();
            disposeDownload();
            disposeLaunch();
            disposeStop();
            disposeRegister();
            disposeUnregister();
        };
    }, 'local-infer: settings routes');
}
//# sourceMappingURL=route.js.map