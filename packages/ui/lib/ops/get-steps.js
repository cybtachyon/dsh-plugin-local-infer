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
 * routine before the deploy is idempotent.
 * @module dsh-plugin-local-infer/ui/ops/get-steps
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeps, chatTemplateArtifactPath, hfChatTemplateCommand, hfDownloadCommand, isModelDirectoryOverridden, modelArtifactPath, } from '../../../core/lib/index.js';
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
 */
async function runSyncBuildStep(ctx) {
    const { request, directory, emit } = ctx;
    if (request.autoRebuild === false) {
        emit('engine sync and build: auto rebuild off, skipped\n');
        return null;
    }
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
 * single presence check the card's Model dropdown and the download route
 * share), plus the Infernix extras a Get leaves ready to launch (the
 * selected DFlash2 drafter and the PLE n-gram volume, pulled through the
 * hf CLI into the model directory). A download failure aborts the run, so
 * a launch never reads a missing model.
 */
async function runModelDownloadStep(ctx) {
    const { localInfer, request, modelDir, useHubCache, emit } = ctx;
    const modelId = typeof request.config.model === 'string' ? request.config.model : undefined;
    if (modelId !== undefined) {
        const entry = defaultModelFor(request.engineId, modelId);
        if (entry === undefined) {
            emit(`model download: ${modelId} has no registered default, skipped\n`);
        }
        else {
            const artifact = modelArtifactPath(entry, modelDir, useHubCache);
            if (existsSync(artifact)) {
                emit(`model download: ${modelId} is already present, skipped\n`);
            }
            else {
                emit(`$ ${hfDownloadCommand(entry, modelDir, useHubCache)}\n`);
                const download = await localInfer.downloadModel(entry, modelDir, {
                    useHubCache,
                    ...(request.signal !== undefined ? { signal: request.signal } : {}),
                    ...(ctx.onChunk !== undefined ? { onChunk: ctx.onChunk } : {}),
                });
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
    const { localInfer, request, modelDir, useHubCache, emit } = ctx;
    const template = typeof request.config.chatTemplate === 'string' ? request.config.chatTemplate : '';
    if (template !== '' && isHfRepoReference(template)) {
        const localPath = chatTemplateArtifactPath(template, modelDir, useHubCache);
        if (existsSync(localPath)) {
            emit(`chat template: ${template} is already present, skipped\n`);
        }
        else {
            emit(`$ ${hfChatTemplateCommand(template, modelDir, useHubCache)}\n`);
            const download = await localInfer.downloadChatTemplate(template, modelDir, {
                useHubCache,
                ...(request.signal !== undefined ? { signal: request.signal } : {}),
                ...(ctx.onChunk !== undefined ? { onChunk: ctx.onChunk } : {}),
            });
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
 * step stops the run and names the broken step in the detail.
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
    // override keeps the flat --local-dir target. modelDir is the hub cache root
    // in the default case, the base the cache-layout paths join onto.
    const useHubCache = !isModelDirectoryOverridden(request.config.modelDirectory);
    const ctx = {
        localInfer,
        request,
        engine,
        directory: resolveEngineDirectory(localInfer, request.config, request.engineId, request.platform),
        modelDir: resolveModelDirectory(localInfer, request.config),
        useHubCache,
        hardware: await localInfer.detectHardware(),
        emit,
        ...(request.onChunk !== undefined ? { onChunk: request.onChunk } : {}),
    };
    ctx.emit(`get ${request.engineId} in ${ctx.directory}\n`);
    for (const step of [runDepsStep, runSyncBuildStep, runModelDownloadStep, runChatTemplateStep]) {
        const failure = await step(ctx);
        if (failure !== null) {
            return { ...failure, logs: chunks.join('') };
        }
    }
    ctx.emit('get complete\n');
    return { ok: true, logs: chunks.join('') };
}
//# sourceMappingURL=get-steps.js.map
