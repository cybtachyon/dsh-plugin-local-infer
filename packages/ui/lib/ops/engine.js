/**
 * The engine lifecycle operations: launchEngine renders the plan the
 * registered adapter produces and runs the service's launch entry point
 * (deploy, then the health poll); stopEngine stops the exact container or
 * process the launch started; getEngine runs the Get step (git sync, dep
 * plan, build, model artifacts). The launch record (the engine pid, start
 * time, launch arguments, and the DSH process pid that launched it) is what
 * a DSH restart re-links a surviving engine to its config:
 * relinkStoredProviders re-adopts surviving engines on mount and per summary
 * read, handleEngineDeath settles the stored state the moment an engine dies
 * outside the stop path, and persistLaunchLogs stores the captured output.
 * The platform-config registry sync keeps the service registry in step with
 * the stored config.
 * @module dsh-plugin-local-infer/ui/ops/engine
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDeps, formatLaunchCommand, launchRecordFromPlan, resolveLogPath, } from '../../../core/lib/index.js';
import { buildEngineRepo, ENGINES, infernixGetDownloads, nodeLifecycleHost, syncEngineRepo, } from '../../../providers/lib/index.js';
import { readConfig, writeConfig } from "../config.js";
import { RouteError } from "../route.js";
import { resolveBuildMode } from "../viewmodels/deps.js";
import { resolveModelDirectory } from "./model.js";
/**
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
export function resolveAdapter(localInfer, engineId) {
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
export async function launchEngine(localInfer, request, onProgress) {
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
    // A launch with no Engine Directory override falls back to the per-engine
    // folder inside the model directory, so the deploy step resolves a relative
    // launch path (the NInfer Windows build tree) against a real checkout. The
    // override is registered so the service's launch reads it; a stored entry
    // that already names a directory is left as-is.
    const platform = request.platform ?? stored.platform[engineId];
    if (platform?.engineDirectory === undefined || platform.engineDirectory.trim() === '') {
        const engineDirectory = resolveEngineDirectory(localInfer, config, engineId, platform);
        setPlatformConfig(localInfer, engineId, { ...platform, engineDirectory });
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
    // The prereqs phase: the system-dependency install the local build needs. It
    // runs only while the Play/Run trust gate is on, the same rule the Get step
    // applies; a failed install aborts the launch before the deploy starts. The
    // card's button reads "Prereqs..." for this phase, so the phase is reported
    // only while an install actually runs (the gate on), not when the deps are
    // already satisfied and the phase is skipped.
    if (stored.allowRunDeps === true) {
        onProgress?.('prereqs');
        // Price the dep plan for the build mode the config names (docker, local,
        // or the Strata binary install), not just the plan kind, so a binary
        // launch installs its own (thinner) dep list.
        const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0];
        const buildMode = resolveBuildMode(engine, config);
        const install = await localInfer.runInstall(engineId, buildMode, hardware);
        if (!install.ok) {
            const result = {
                plan,
                healthy: false,
                detail: 'a system dependency install failed',
            };
            persistLaunchLogs(result, engineId, config);
            persistLaunchRecord(result, engineId, config, request.providerId);
            return result;
        }
    }
    // The trust gate and the auto-rebuild flag ride into the deploy step, which
    // reads them to decide whether a rebuild's missing-binary symlink into
    // /usr/local/bin runs (on) or is written to the card's Logs section (off),
    // and whether the git sync (fetch, rebase, rebuild) runs at all.
    const result = await localInfer.launch(plan, {
        ...(onProgress !== undefined ? { onProgress } : {}),
        allowRunDeps: stored.allowRunDeps,
        ...(request.autoRebuild !== undefined ? { autoRebuild: request.autoRebuild } : {}),
    });
    // Order the run logs: the build output (the rebuild decision, the build
    // command, and its output) leads, the launch command follows it (after a
    // successful build, or a direct launch with no build), and the engine's
    // runtime output comes last. A deploy that failed before the engine printed
    // anything still reports the command it tried to run.
    const buildLogs = result.buildLogs ?? '';
    const engineLogs = result.logs ?? '';
    result.logs = buildLogs + (commandNote ?? '') + engineLogs;
    if (result.buildLogs !== undefined) {
        delete result.buildLogs;
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
    // The "Launching..." separator leads the persisted run, so the Logs
    // section and the log file read the launch as a fresh process section, the
    // same line the card writes when a Launch button is clicked.
    const logs = result.logs === undefined || result.logs === '' ? '' : `--- Launching...\n${result.logs}`;
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
    // The user's local build command (the card's Build commands field) overrides
    // the engine's default build steps; absent runs the engine's acquisition
    // steps. The host OS picks the engine's OS profile (the Windows vcpkg route
    // and its powershell.exe shell on a Windows host, the cmake route elsewhere).
    const build = await buildEngineRepo(host, engineId, directory, log, platform?.buildCommands, hardware.os);
    if (!build.ok) {
        if (build.detail !== undefined) {
            log(`!! ${build.detail}\n`);
        }
        return { ok: false, ...(build.detail !== undefined ? { detail: build.detail } : {}) };
    }
    // The model artifacts a Get leaves ready to launch: the Infernix DFlash2
    // drafter (when a preset is selected) and the PLE n-gram volume (when the
    // model key names one), pulled through the hf CLI into the model directory.
    // A download failure aborts the Get, so a launch never reads a missing
    // drafter or table.
    if (engineId === 'infernix') {
        const modelDir = resolveModelDirectory(localInfer, config);
        for (const command of infernixGetDownloads(config, modelDir)) {
            log(`$ ${command}\n`);
            const outcome = host.runStream !== undefined
                ? await host.runStream(command, (chunk) => log(chunk))
                : await host.run(command);
            if (!outcome.ok) {
                log(`!! ${command} failed: ${outcome.detail ?? 'unknown'}\n`);
                return { ok: false, detail: 'a model artifact download failed' };
            }
        }
    }
    log('get complete\n');
    return { ok: true };
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
export function syncPlatformConfigs(localInfer, stored) {
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
//# sourceMappingURL=engine.js.map