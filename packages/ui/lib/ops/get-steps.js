/**
 * The shared Get-steps routine both getEngine and launchEngine route through:
 * it runs, in order, (1) the engine's system-dependency install for the host
 * OS (gated by the Play/Run trust gate), (2) the git clone of the engine repo
 * (or the fork) plus the fetch/rebase of a clean checkout, (3) the source
 * build step (the compose engines carry no local build steps), (4) the hf
 * download of the selected model when it is not already present, and (5) the
 * hf download of any selected chat template when it is not already present.
 * Every step streams through the log sink as it lands, and an already-
 * satisfied step is skipped and logged as such, so a Launch that runs the
 * routine before the deploy is idempotent. A Launch can set
 * `continueOnSyncFailure` on the request: when the git sync (rebase) of an
 * existing checkout fails, the run keeps going with the checkout's current
 * version and reports `syncFailed` on the result, so a broken rebase never
 * halts the launch. A standalone Get omits the flag and keeps stopping on a
 * sync failure.
 * @module dsh-plugin-local-infer/ui/ops/get-steps
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeps, chatTemplateArtifactPath, hfChatTemplateCommand, hfDownloadCommand, hfHubCacheDirectory, isModelDirectoryOverridden, modelArtifactPath, } from '../../../core/lib/index.js';
import { buildEngineRepo, defaultModelFor, ENGINES, infernixGetDownloads, syncEngineRepo, } from '../../../providers/lib/index.js';
import { isHfRepoReference } from "../viewmodels/summaryHelpers.js";
import { resolveBuildMode } from "../viewmodels/deps.js";
import { resolveModelDirectory } from "./model.js";
/**
 * resolveEngineDirectory picks the checkout the Get step syncs: the Engine
 * Directory override when it names a path, else a per-engine folder inside
 * the model directory (the default model directory, or the config's
 * override), so a Get with no override still has a real place to live.
 */
export function resolveEngineDirectory(localInfer, config, engineId, platform) {
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
 * The marker a Get step reports when it fails non-fatally: the git sync of
 * an existing checkout failed while the `continueOnSyncFailure` override is
 * on, so the runner keeps going (skipping the build) and threads
 * `syncFailed` into the result while the launch continues.
 */
const SYNC_FAILED = { kind: 'syncFailed' };
/**
 * downloadOptions builds the exactOptionalPropertyTypes-safe download options
 * a Get step's hf download runs with: the hub-cache layout flag, the run's
 * cancel signal, and the onChunk progress sink, each present only when the
 * run carries it, so an absent field never writes `undefined`. The model and
 * chat-template steps share it, so the option group (the directory layout,
 * the cancel, the progress sink) is built in one place.
 */
function downloadOptions(ctx) {
    return {
        useHubCache: ctx.useHubCache,
        ...(ctx.request.signal !== undefined ? { signal: ctx.request.signal } : {}),
        ...(ctx.onChunk !== undefined ? { onChunk: ctx.onChunk } : {}),
    };
}
/**
 * runDepsStep is the Get step's system-dependency install: it runs the
 * install while the Play/Run trust gate is on, and re-checks the deps with
 * a copy/paste note when the gate is off, so a missing dependency aborts the
 * run instead of a broken build.
 */
async function runDepsStep(ctx) {
    const { localInfer, request, engine, hardware, emit } = ctx;
    const buildMode = resolveBuildMode(engine, request.config);
    emit(`system dependencies (${buildMode})\n`);
    if (request.allowRunDeps === true) {
        const install = await localInfer.runInstall(request.engineId, buildMode, hardware);
        for (const entry of install.results) {
            emit(`  ${entry.id}: ${entry.status}${entry.detail !== undefined ? ` (${entry.detail})` : ''}\n`);
        }
        if (!install.ok) {
            emit('!! a system dependency install failed; copy the install string from the panel\n');
            return { ok: false, detail: 'a system dependency install failed' };
        }
        return null;
    }
    const deps = await localInfer.deps(request.engineId, buildMode, hardware);
    const checks = await checkDeps(deps, hardware);
    let missing = false;
    for (const check of checks) {
        emit(`  ${check.dep.id}: ${check.status}\n`);
        if (check.status !== 'satisfied')
            missing = true;
    }
    if (missing) {
        emit('!! a system dependency is missing and one-click install is off; copy the install string from the panel\n');
        return { ok: false, detail: 'a system dependency is missing' };
    }
    return null;
}
/**
 * runSyncBuildStep is the Get step's git clone (or fork) of the engine repo,
 * the fetch and rebase of a clean checkout, and the source build step (the
 * compose engines carry no local build steps and pass through). A checkout
 * with local changes aborts, so the user's work is never rebased away. The
 * Auto Rebuild checkbox off skips both, so a launch reads the checkout as-is.
 * Under the `continueOnSyncFailure` override, a failed sync of an existing
 * checkout reports the SYNC_FAILED marker (the run keeps going with the
 * checkout's current version and the build is skipped); a failed clone of a
 * missing checkout stays fatal, since there is no current version to launch.
 */
async function runSyncBuildStep(ctx) {
    const { request, directory, emit } = ctx;
    if (request.autoRebuild === false) {
        emit('engine sync and build: auto rebuild off, skipped\n');
        return null;
    }
    // The distinct clone and build headers let the Logs-header step chips track
    // the two sub-steps separately: the clone chip runs until the build header
    // lands, and the build chip runs until the model header lands.
    emit(`engine clone: ${request.engineId}\n`);
    const fork = request.platform?.engineFork;
    const sync = await syncEngineRepo(request.host, {
        engineId: request.engineId,
        directory,
        ...(fork !== undefined && fork.trim() !== '' ? { fork } : {}),
    }, emit);
    if (!sync.ok) {
        // A dirty checkout already alerted in the sync step; any other failure
        // names its step here.
        if (sync.aborted !== true && sync.detail !== undefined) {
            emit(`!! ${sync.detail}\n`);
        }
        // The `continueOnSyncFailure` override (a Launch-only flag): when the git
        // sync of an existing checkout fails, the run keeps going with the
        // checkout's current version (the build is skipped, since the rebase
        // failed and the checkout stays where it is) and reports the failure
        // non-fatally, so a broken rebase never halts the launch. The sync result
        // names the path it took: a fresh clone (cloned) means no prior checkout
        // to launch, so a clone failure stays fatal; a rebase, fetch, or dirty
        // checkout of an existing checkout (no clone) is non-fatal under the
        // override. Reading the flag keeps the checkout-presence decision in the
        // one place that probes it (the git rev-parse in the sync step).
        if (request.continueOnSyncFailure === true && sync.cloned !== true) {
            emit('!! engine sync failed; continuing with the current version\n');
            return SYNC_FAILED;
        }
        return {
            ok: false,
            ...(sync.detail !== undefined ? { detail: sync.detail } : {}),
        };
    }
    // The user's local build command (the card's Build commands field)
    // overrides the engine's default build steps; absent runs the engine's
    // acquisition steps. The host OS picks the engine's OS profile (the
    // Windows vcpkg route and its pwsh.exe shell on a Windows host, the
    // cmake route elsewhere).
    emit(`engine build: ${request.engineId}\n`);
    const build = await buildEngineRepo(request.host, request.engineId, directory, emit, request.platform?.buildCommands, ctx.hardware.os);
    if (!build.ok) {
        if (build.detail !== undefined) {
            emit(`!! ${build.detail}\n`);
        }
        return {
            ok: false,
            ...(build.detail !== undefined ? { detail: build.detail } : {}),
        };
    }
    return null;
}
/**
 * runModelDownloadStep is the Get step's hf download of the selected model,
 * skipped when the artifact is already present in the model directory (the
 * hub cache under the cache layout; the single presence check the card's
 * Model dropdown and the download route share), plus the Infernix extras a
 * Get leaves ready to launch (the selected DFlash2 drafter and the PLE n-gram
 * volume, pulled through the hf CLI into the model directory). A download
 * failure aborts the run, so a launch never reads a missing model.
 */
async function runModelDownloadStep(ctx) {
    const { localInfer, request, modelDir, hubCacheRoot, useHubCache, emit } = ctx;
    const modelId = typeof request.config.model === 'string' ? request.config.model : undefined;
    if (modelId !== undefined) {
        const entry = defaultModelFor(request.engineId, modelId);
        if (entry === undefined) {
            emit(`model download: ${modelId} has no registered default, skipped\n`);
        }
        else {
            // The cache-layout presence join uses the hub cache root (where the
            // models--{ns}--{name} dirs live); modelDir may name the resolved
            // snapshot directory, which is not a join base.
            const artifact = modelArtifactPath(entry, useHubCache ? hubCacheRoot : modelDir, useHubCache);
            if (existsSync(artifact)) {
                emit(`model download: ${modelId} is already present, skipped\n`);
            }
            else {
                emit(`$ ${hfDownloadCommand(entry, modelDir, useHubCache)}\n`);
                const download = await localInfer.downloadModel(entry, modelDir, downloadOptions(ctx));
                if (!download.ok) {
                    emit(`!! ${download.detail ?? 'model download failed'}\n`);
                    return { ok: false, detail: download.detail ?? 'a model download failed' };
                }
            }
        }
    }
    else {
        emit('model download: no model selected, skipped\n');
    }
    if (request.engineId === 'infernix') {
        for (const command of infernixGetDownloads(request.config, modelDir, useHubCache)) {
            emit(`$ ${command}\n`);
            // The Infernix extra downloads stream through the host, so their tqdm
            // lines reach the log sink and the onChunk progress sink together, the
            // way the model and template downloads do. A caller that does not
            // stream progress (onChunk absent) still lands the chunk in the log
            // sink only.
            const outcome = request.host.runStream !== undefined
                ? await request.host.runStream(command, (chunk) => {
                    emit(chunk);
                    ctx.onChunk?.(chunk);
                }, {
                    ...(request.signal !== undefined ? { signal: request.signal } : {}),
                })
                : await request.host.run(command);
            if (!outcome.ok) {
                emit(`!! ${command} failed: ${outcome.detail ?? 'unknown'}\n`);
                return { ok: false, detail: 'a model artifact download failed' };
            }
        }
    }
    return null;
}
/**
 * runChatTemplateStep is the Get step's hf download of the selected chat
 * template (an HF repo reference the form's combo control offers), skipped
 * when the template file is already present in the model directory.
 */
async function runChatTemplateStep(ctx) {
    const { localInfer, request, modelDir, hubCacheRoot, useHubCache, emit } = ctx;
    const template = typeof request.config.chatTemplate === 'string' ? request.config.chatTemplate : '';
    if (template !== '' && isHfRepoReference(template)) {
        // Same join-base rule as the model step: the cache layout resolves under
        // the hub cache root, not the resolved model directory.
        const localPath = chatTemplateArtifactPath(template, useHubCache ? hubCacheRoot : modelDir, useHubCache);
        if (existsSync(localPath)) {
            emit(`chat template: ${template} is already present, skipped\n`);
        }
        else {
            emit(`$ ${hfChatTemplateCommand(template, modelDir, useHubCache)}\n`);
            const download = await localInfer.downloadChatTemplate(template, modelDir, downloadOptions(ctx));
            if (!download.ok) {
                emit(`!! ${download.detail ?? 'chat template download failed'}\n`);
                return { ok: false, detail: download.detail ?? 'a chat template download failed' };
            }
        }
    }
    return null;
}
/**
 * runGetSteps is the shared Get-steps routine. It runs the five steps in
 * order, streaming each through log and collecting the same text as the
 * result's logs, so a caller can persist the run (a Get) or thread it into
 * the launch's persisted logs (a Launch) without re-running the steps. A
 * step that is already satisfied is skipped and logged as such; a failing
 * step stops the run and names the broken step in the detail. A step that
 * fails non-fatally (the git sync under the `continueOnSyncFailure`
 * override) keeps the run going and threads `syncFailed` into the result, so
 * the launch continues with the checkout's current version.
 */
export async function runGetSteps(localInfer, request, log) {
    const chunks = [];
    const emit = (chunk) => {
        chunks.push(chunk);
        log(chunk);
    };
    // ENGINES is a known non-empty constant, so the fallback is always defined.
    const engine = ENGINES.find((entry) => entry.id === request.engineId) ?? ENGINES[0];
    // The hub-cache layout (no --local-dir, the models--{ns}--{name} dirs)
    // applies only when the model directory is the plugin default; a user
    // override keeps the flat --local-dir target. modelDir names the resolved
    // directory for the model: the override, the hub-cache snapshot holding a
    // cached artifact (the hf download result), or the hub cache root when
    // nothing is cached yet. hubCacheRoot stays the base the cache-layout
    // presence checks join onto, whatever modelDir resolves to.
    const useHubCache = !isModelDirectoryOverridden(request.config.modelDirectory);
    const selectedModelId = typeof request.config.model === 'string' ? request.config.model : undefined;
    const modelEntry = selectedModelId === undefined ? undefined : defaultModelFor(request.engineId, selectedModelId);
    const ctx = {
        localInfer,
        request,
        engine,
        directory: resolveEngineDirectory(localInfer, request.config, request.engineId, request.platform),
        modelDir: resolveModelDirectory(request.config, modelEntry),
        hubCacheRoot: hfHubCacheDirectory(),
        useHubCache,
        hardware: await localInfer.detectHardware(),
        emit,
        ...(request.onChunk !== undefined ? { onChunk: request.onChunk } : {}),
    };
    ctx.emit(`get ${request.engineId} in ${ctx.directory}\n`);
    // A non-fatal sync failure (the `continueOnSyncFailure` override) keeps the
    // run going through the remaining steps; the flag threads into the result
    // so the launch skips the deploy's own git sync and launches the checkout's
    // current version.
    let syncFailed = false;
    for (const step of [runDepsStep, runSyncBuildStep, runModelDownloadStep, runChatTemplateStep]) {
        const failure = await step(ctx);
        if (failure !== null) {
            if ('kind' in failure) {
                syncFailed = true;
                continue;
            }
            return { ...failure, logs: chunks.join('') };
        }
    }
    ctx.emit('get complete\n');
    return {
        ok: true,
        logs: chunks.join(''),
        ...(syncFailed ? { syncFailed: true } : {}),
    };
}
//# sourceMappingURL=get-steps.js.map
