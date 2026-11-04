/**
 * The Basalt engine adapter. BasaltAdapter is the Basalt engine (the C++/CUDA
 * serve/ server for the Qwen3.8-Flash-Next MoE model, Blackwell-only).
 * `renderLaunch` renders a `basalt serve --config` process plan: the binary
 * name comes from the host OS profile, and every setting lands in the
 * `basalt_config.json` the plan's `configFile` carries (rendered from the
 * spec surface with `configFileFromSpecs`), so the launch argv stays three
 * tokens long no matter how many settings the form offers. `deploy` builds
 * the engine in the checkout (the acquisition build steps), downloads the
 * `.basalt` model into the model directory, writes the config file, and
 * spawns the serve command. `healthCheck` polls the health URL and reports
 * the start phase from the tracked process output. `stop` signals the
 * tracked process.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltAdapter
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { EngineAdapter, hfDownloadCommand, hfHubCacheDirectory, modelArtifactPath, } from '../../../../core/lib/index.js';
import { configFileFromSpecs, nodeLifecycleHost, pollHealth, stopProcessPlan, trackChild, } from "../../adapters.js";
import { syncAndRebuildEngine } from "../../acquire.js";
import { BASALT_PARAMETERS, basaltModelKey } from "./basalt.js";
import { basaltLinuxBinary } from "./basaltLinux.js";
import { basaltMacOSBinary } from "./basaltMacOS.js";
import { basaltWindowsBinary } from "./basaltWindows.js";
/**
 * The Basalt engine binary is OS-specific (the .exe on Windows, where the
 * Ninja/MSVC route writes the Release binary), so the launch binary comes
 * from the host OS's binary function. The adapter's renderLaunch reads this
 * map by the hardware profile's os, keeping the per-OS name in its own OS
 * file.
 */
const BASALT_BINARY = {
    linux: basaltLinuxBinary,
    macos: basaltMacOSBinary,
    windows: basaltWindowsBinary,
};
/**
 * The Hugging Face repo and file the deploy step downloads into the model
 * directory: the single `.basalt` artifact the engine serves (the weights,
 * tokenizer, chat template, drafter, vision projector, and default
 * sampling all come from it).
 */
export const BASALT_MODEL_REPO = 'jesdga/Qwen3.8-Flash-Next-Basalt';
export const BASALT_MODEL_FILE = 'Qwen3.8-FN-NVFP4-DQ6_K.basalt';
/**
 * The config file name the deploy step writes into the model directory, so
 * the engine's `--config` flag and the model artifact share one home.
 */
export const BASALT_CONFIG_FILE = 'basalt_config.json';
/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config` process plan (the settings ride the config file,
 * never the argv); `deploy` builds the engine, downloads the model, writes
 * the config file, and spawns the serve command; `healthCheck` polls the
 * health URL and reports the start phase from the tracked process output;
 * `stop` signals the tracked process.
 */
export class BasaltAdapter extends EngineAdapter {
    id = 'basalt';
    supports = { docker: false, local: true };
    host;
    children = new Map();
    constructor(host = nodeLifecycleHost) {
        super();
        this.host = host;
    }
    parameters() {
        return BASALT_PARAMETERS;
    }
    modelRef(config) {
        // The engine serves the model file the config names (a .basalt path), so
        // the registrar publishes that path and a chat turn routes to it. A bare
        // config (the deploy step downloads the default artifact) reads as the
        // engine name.
        const model = basaltModelKey(config);
        return model !== '' ? { id: model, name: model } : { id: 'basalt', name: 'Basalt' };
    }
    modelInput(config) {
        // The vision control gates the image input. off (the default) reads no
        // pictures; every other value (dynamic, cpu, a pinned GPU number spelled
        // as a string or a number) does.
        const vision = config.vision;
        if (typeof vision === 'number') {
            return ['text', 'image'];
        }
        if (typeof vision === 'string' && vision !== '' && vision !== 'off') {
            return ['text', 'image'];
        }
        return ['text'];
    }
    launchSignature(config = {}) {
        // The local plan runs the basalt binary, so the binary name is the
        // command-line marker the reserve probe matches on.
        const port = this.port(config);
        return { binary: 'basalt', port };
    }
    renderLaunch(config, _hw) {
        const port = this.port(config);
        const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : '';
        // The config file lands in the model directory (the engine's --config flag
        // and the model artifact share one home). A bare config (no model
        // directory) writes it into the spawn's working directory.
        const configPath = modelDirectory === '' ? BASALT_CONFIG_FILE : join(modelDirectory, BASALT_CONFIG_FILE);
        // The engine binary is OS-specific (the .exe on Windows), so the name
        // comes from the host OS's binary function.
        const binary = BASALT_BINARY[_hw.os]();
        return {
            engineId: this.id,
            kind: 'process',
            argv: [binary, 'serve', '--config', configPath],
            env: {},
            ...(modelDirectory === '' ? {} : { modelDirectory }),
            port,
            healthUrl: `http://127.0.0.1:${port}/health`,
            os: _hw.os,
            // Every setting rides the config file the deploy step writes, so the
            // argv stays three tokens long no matter how many settings the form
            // offers.
            configFile: {
                path: configPath,
                content: configFileFromSpecs(BASALT_PARAMETERS, config, 'json'),
            },
        };
    }
    async deploy(plan, platform, onProgress, options) {
        if (plan.kind !== 'process') {
            // Basalt renders process plans only; a docker or compose plan is a
            // no-op.
            return { ok: true };
        }
        const engineDir = platform?.engineDirectory;
        let buildLogs = '';
        // Auto Rebuild off (the card's checkbox): the git sync (fetch, rebase,
        // rebuild) is skipped and the checkout launches as-is.
        if (engineDir !== undefined && options?.autoRebuild !== false) {
            // The git sync is the checkout download: the card's button reads
            // "Downloading..." for it, not "Building...".
            onProgress?.('download');
            // The conditional rebuild fetches the checkout, prices it against the
            // remote branch, and rebuilds only when it is behind (or a fresh
            // clone). The decision, the build command, and its output are captured
            // into buildLogs and threaded to the card's Logs section.
            const sync = await syncAndRebuildEngine(this.host, {
                engineId: this.id,
                directory: engineDir,
                ...(platform?.engineFork !== undefined ? { fork: platform.engineFork } : {}),
                ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
                ...(platform?.buildCommands !== undefined
                    ? { buildCommands: platform.buildCommands }
                    : {}),
                // The host OS the build steps pick for: a Windows host reads the
                // engine's Windows build steps (the Ninja/MSVC route) when the user
                // carries no build-command override.
                ...(plan.os !== undefined ? { os: plan.os } : {}),
                // Report the build phase the moment the build steps start, so the
                // card's button reads "Building..." while the build is in flight.
                onBuildStart: () => onProgress?.('build'),
            }, () => { });
            buildLogs = sync.logs;
            if (!sync.ok) {
                return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs };
            }
            // The build output reads as a fresh Logs section: a "Building..."
            // separator leads the build decision and output, the same line the
            // card writes when the build step event lands.
            if (sync.rebuilt && buildLogs !== '') {
                buildLogs = `--- Building...\n${buildLogs}`;
            }
        }
        const withLogs = (result) => buildLogs !== '' ? { ...result, logs: buildLogs } : result;
        // The .basalt model artifact the engine serves, downloaded into the model
        // directory. A bare config (no model directory) downloads into the hub
        // cache (the hub-cache layout, no --local-dir); a user-overridden model
        // directory keeps the flat --local-dir target. A model the shared
        // Get-steps routine already downloaded is on disk, so the deploy step
        // skips the re-fetch and a launch after a Get does no duplicate download.
        const useHubCache = plan.modelDirectory === undefined || plan.modelDirectory === '';
        const baseDir = useHubCache ? hfHubCacheDirectory() : (plan.modelDirectory ?? '.');
        const entry = {
            engineId: this.id,
            modelId: 'basalt',
            label: 'Basalt',
            url: `https://huggingface.co/${BASALT_MODEL_REPO}`,
            file: BASALT_MODEL_FILE,
        };
        if (!existsSync(modelArtifactPath(entry, baseDir, useHubCache))) {
            onProgress?.('download');
            const download = await this.host.run(hfDownloadCommand(entry, baseDir, useHubCache));
            if (!download.ok) {
                return withLogs({
                    ok: false,
                    detail: `model download failed: ${download.detail ?? 'unknown'}`,
                });
            }
        }
        // Write the config file the plan names, so the engine's --config flag
        // points at a path that exists. A host that cannot write files (a test
        // stub) fails the launch rather than spawn an engine that reads no
        // config.
        if (plan.configFile !== undefined) {
            if (this.host.writeFile === undefined) {
                return withLogs({ ok: false, detail: 'the host cannot write the config file' });
            }
            await this.host.writeFile(plan.configFile.path, plan.configFile.content);
        }
        // A relative launch path (a build-tree binary) is joined against the
        // engine directory the spawn runs in, so the spawn resolves an absolute
        // path. A bare name (the basalt binary, on the path after the rebuild's
        // symlink step) is left as-is.
        const argv = plan.argv ?? [];
        const first = argv[0];
        const resolvedArgv = engineDir !== undefined &&
            first !== undefined &&
            !isAbsolute(first) &&
            (first.includes('\\') || first.includes('/'))
            ? [join(engineDir, first), ...argv.slice(1)]
            : argv;
        const handle = this.host.spawn(resolvedArgv, plan.env ?? {}, engineDir);
        trackChild(this.children, this.planKey(plan), handle);
        return withLogs({ ok: true, handle });
    }
    async healthCheck(plan, options) {
        // The health poll is the shared loop (a 200 is ready, the attempt cap
        // times out). Basalt downloads its model in the deploy step, so the
        // engine's own start has no download phase: a tracked process that is
        // still coming up reads as starting, and a missing handle (no deploy
        // tracked one, or the process already ended) reads as failed.
        const result = await pollHealth(this.host, plan, options);
        if (result.healthy) {
            return { ...result, state: 'ready' };
        }
        const handle = this.children.get(this.planKey(plan));
        const state = handle !== undefined && (handle.logs ?? '') !== '' ? 'starting' : 'failed';
        return { ...result, state };
    }
    async stop(plan) {
        // The serve process is the tracked child: signal it and drop the entry,
        // so a later stop never signals a pid a recycled process has taken over.
        const handle = this.children.get(this.planKey(plan));
        if (handle !== undefined) {
            handle.kill();
            this.children.delete(this.planKey(plan));
            return;
        }
        // No tracked child (an engine a DSH restart re-adopted): signal the pid
        // the stored launch record stamped on the plan, so the stop reaches a
        // process this adapter instance did not spawn.
        await stopProcessPlan(this.host, plan);
    }
    port(config) {
        // 8080 is the port the basalt serve CLI binds by default, so a bare
        // config launches on it.
        return typeof config.port === 'number' ? config.port : 8080;
    }
    planKey(plan) {
        return `${plan.engineId}:${plan.port}`;
    }
}
//# sourceMappingURL=basaltAdapter.js.map
