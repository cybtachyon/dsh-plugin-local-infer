/**
 * The Strata engine adapter. StrataAdapter is the Strata engine, three build
 * modes. `renderLaunch` renders a `docker run` of the ghcr image (docker
 * mode), a `strata launch` process (binary mode), or a `setup.sh` run with the
 * model (local mode); `deploy` pulls the image, installs the Terminal, or
 * git-syncs the checkout and resolves `setup.sh` to an absolute path in it
 * before spawning (spawn resolves a bare name against PATH, not the cwd);
 * `healthCheck` polls the health URL; `stop` stops the named container, runs
 * `strata launch --stop`, or signals the tracked process. The model the
 * engine serves is the config model (or the engine's own pick when none is
 * named), and the engine downloads it itself, so the deploy step runs no model
 * download of its own. When the config names no model, `discoverModel`
 * queries the running engine's model endpoint through the terminal for the id
 * it actually loaded (family and size sized to the host), so the registrar
 * publishes the served model, not a placeholder.
 * @module dsh-plugin-local-infer/providers/engines/strataAdapter
 */
import { join } from 'node:path';
import { EngineAdapter } from '../../../core/lib/index.js';
import { customArgEnv, customArgFlags, delay, envFromSpecs, flagsFromSpecs, nodeLifecycleHost, trackChild, } from "../adapters.js";
import { syncAndRebuildEngine } from "../acquire.js";
import { STRATA_PARAMETERS, strataModelKey } from "./strata.js";
/**
 * The Strata docker image the adapter pulls and runs. The image is the
 * upstream GitHub Container Registry artifact for the newest release's CUDA 13
 * flavor (NVIDIA RTX 20/30/40/50 series, driver 580 or newer); the README pins
 * a version tag when updates should only land on purpose.
 */
export const STRATA_DOCKER_IMAGE = 'ghcr.io/niko1221/strata:latest-cuda13';
/**
 * The one-line install the Strata binary build mode runs: it downloads the
 * `strata` Terminal from the latest release, checks its SHA-256, unpacks it into
 * the user's home folder, and puts `strata` on the PATH. Sourced from
 * docs/AI_SETUP.md step 2 (Linux and Mac; Windows uses the PowerShell twin).
 */
export const STRATA_BINARY_INSTALL = 'curl -fsSL https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o install.sh && sh install.sh';
/**
 * strataPreReadyState reads the phase the strata process is in from the tail of
 * its accumulated output. The Terminal downloads the engine and the model files
 * before it can serve, and prints a progress line for each (Downloading,
 * Unpacking, Checking the package signature, Getting the model files, ...), so
 * a tail that carries one of those reads as downloading. A tail past the
 * download (the engine starting, the API binding) reads as starting. The tail
 * is the most recent output, so a finished download no longer reads as
 * downloading even though its progress lines are still in the buffer.
 */
export function strataPreReadyState(logs) {
    const tail = logs.slice(-2000);
    const downloading = /Downloading|Unpacking|Checking the package signature|Test-starting|Getting the model files|Getting your model ready|Getting the helper packages/i.test(tail);
    return downloading ? 'downloading' : 'starting';
}
/**
 * strataServedModelId reads the served model id out of a /v1/models answer:
 * the id of the first entry in the JSON `data` list. The engine names the
 * model it auto-selected with family and size (qwen3.8-flash-next-iq3_s), so
 * the registrar can publish the id the engine actually serves. A body that is
 * not JSON, or carries no usable id (an error page, a truncated answer), reads
 * as no discovery.
 */
export function strataServedModelId(body) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(body.slice(start, end + 1));
        const list = Array.isArray(parsed.data) ? parsed.data : [];
        for (const item of list) {
            const id = typeof item === 'object' && item !== null ? item.id : undefined;
            if (typeof id === 'string' && id !== '') {
                return id;
            }
        }
    }
    catch {
        // A partial or non-JSON answer (an error page, a truncated body) carries
        // no served id.
    }
    return undefined;
}
/**
 * StrataAdapter is the Strata engine, three build modes. `renderLaunch` renders
 * a `docker run` of the ghcr image (docker mode), a `strata launch` process
 * (binary mode), or a `setup.sh` run with the model (local mode); `deploy` pulls
 * the image, installs the Terminal, or git-syncs the checkout and resolves
 * `setup.sh` to an absolute path in it before spawning (spawn resolves a bare
 * name against PATH, not the cwd); `healthCheck` polls the health URL; `stop`
 * stops the named container, runs `strata launch --stop`, or signals the
 * tracked process. The model the engine serves is the config model (or the
 * engine's own pick when none is named), and the engine downloads it itself, so
 * the deploy step runs no model download of its own. When the config names no
 * model, `discoverModel` queries the running engine's model endpoint through
 * the terminal for the id it actually loaded (family and size sized to the
 * host), so the registrar publishes the served model, not a placeholder.
 */
export class StrataAdapter extends EngineAdapter {
    id = 'strata';
    supports = { docker: true, local: true, binary: true };
    host;
    children = new Map();
    constructor(host = nodeLifecycleHost) {
        super();
        this.host = host;
    }
    parameters() {
        return STRATA_PARAMETERS;
    }
    modelRef(config) {
        // Strata serves the model under the name the config names (or the engine
        // default when none), so the registrar publishes that name and a chat turn
        // routes to it.
        const model = strataModelKey(config);
        return model !== '' ? { id: model, name: model } : { id: 'strata', name: 'Strata' };
    }
    async discoverModel(config) {
        // A config that names a model already routes through modelRef; discovery
        // answers only for the model the engine auto-selected for the host.
        if (strataModelKey(config) !== '') {
            return undefined;
        }
        // The terminal query: curl the running engine's model list, capped at a
        // few seconds so a down engine fails fast rather than parking the
        // register route. A host without output capture cannot read the answer,
        // so it discovers nothing and the route falls back to modelRef.
        const runStream = this.host.runStream;
        if (runStream === undefined) {
            return undefined;
        }
        const port = this.port(config);
        const chunks = [];
        const outcome = await runStream.call(this.host, `curl -fsS --max-time 3 http://127.0.0.1:${port}/v1/models`, (chunk) => {
            chunks.push(chunk);
        });
        if (!outcome.ok) {
            return undefined;
        }
        const id = strataServedModelId(chunks.join(''));
        return id === undefined ? undefined : { id, name: id };
    }
    modelInput(config) {
        // Strata's models read pictures and the vision control is on by default
        // (on, gpu, and cpu all enable a vision runner), so only 'off' withholds
        // the Image input on the DSH model row.
        return config.vision === 'off' ? ['text'] : ['text', 'image'];
    }
    launchSignature(config = {}) {
        // The docker plan's host process is docker run of the ghcr image, so the
        // image name is the command-line marker; the binary and source-build plans
        // run the strata command, so the binary name is the marker.
        const port = this.port(config);
        if (this.buildMode(config) === 'docker') {
            return { binary: STRATA_DOCKER_IMAGE, port };
        }
        return { binary: 'strata', port };
    }
    renderLaunch(config, _hw) {
        const port = this.port(config);
        const model = strataModelKey(config);
        const modelId = model !== '' ? model : undefined;
        const customArgs = customArgFlags(config);
        const mode = this.buildMode(config);
        if (mode === 'docker') {
            // The container env is the spec surface's toEnv spellings (FAMILY,
            // CONTEXT, VISION, ...) plus the card's Custom Arguments, plus the model
            // the container serves. The model download happens inside the container
            // on first start into the strata-data volume, so no host download.
            const env = { ...envFromSpecs(STRATA_PARAMETERS, config), ...customArgEnv(config) };
            if (model !== '') {
                env.MODEL = model;
            }
            const envFlags = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
            const containerName = `strata-${port}`;
            return {
                engineId: this.id,
                kind: 'docker',
                argv: [
                    'docker',
                    'run',
                    '-d',
                    '--name',
                    containerName,
                    '--gpus',
                    'all',
                    '-p',
                    `127.0.0.1:${port}:8080`,
                    '--ulimit',
                    'memlock=-1:-1',
                    '--shm-size',
                    '2g',
                    '--stop-timeout',
                    '120',
                    '-v',
                    'strata-data:/data',
                    ...envFlags,
                    STRATA_DOCKER_IMAGE,
                    ...customArgs,
                ],
                env: {},
                containerName,
                ...(modelId !== undefined ? { modelId } : {}),
                port,
                healthUrl: `http://127.0.0.1:${port}/health`,
            };
        }
        if (mode === 'binary') {
            // The strata Terminal the install script places on the PATH: a
            // non-interactive launch that downloads what it needs and serves.
            const flags = flagsFromSpecs(STRATA_PARAMETERS, config);
            return {
                engineId: this.id,
                kind: 'process',
                argv: [
                    'strata',
                    'launch',
                    ...(model !== '' ? ['--model', model] : []),
                    '--yes',
                    '--no-tui',
                    '--port',
                    String(port),
                    ...flags,
                    ...customArgs,
                ],
                env: {},
                ...(modelId !== undefined ? { modelId } : {}),
                port,
                healthUrl: `http://127.0.0.1:${port}/health`,
            };
        }
        // The source build: run setup.sh with the model. It reuses the engine the
        // Get step built (the acquisition build step), downloads the named model,
        // and starts the engine. Running setup.sh (rather than a pre-written
        // run-<model>.sh start script) is model-aware and self-contained, so the
        // launch does not depend on the build step having written a script for this
        // exact model. The deploy step resolves setup.sh to an absolute path in the
        // checkout before spawning.
        const family = typeof config.family === 'string' && config.family !== '' ? config.family : 'qwen';
        const vision = typeof config.vision === 'string' && config.vision !== '' ? config.vision : 'on';
        const context = typeof config.context === 'string' && config.context !== '' ? config.context : undefined;
        // setup.sh's --vision takes yes|no|gpu|cpu; the surface's on|off maps onto
        // it (gpu and cpu pass through).
        const visionFlag = vision === 'on' ? 'yes' : vision === 'off' ? 'no' : vision;
        return {
            engineId: this.id,
            kind: 'process',
            argv: [
                'setup.sh',
                '--yes',
                ...(model !== '' ? ['--model', model] : []),
                ...(family !== 'qwen' ? ['--family', family] : []),
                '--vision',
                visionFlag,
                ...(context !== undefined ? ['--context', context] : []),
                '--port',
                String(port),
                ...customArgs,
            ],
            env: {},
            ...(modelId !== undefined ? { modelId } : {}),
            port,
            healthUrl: `http://127.0.0.1:${port}/health`,
        };
    }
    async deploy(plan, platform, onProgress, options) {
        if (plan.kind === 'docker') {
            // The image pull is the docker build step: the card's button reads
            // "Building..." for it.
            onProgress?.('build');
            const pull = await this.host.run(`docker pull ${STRATA_DOCKER_IMAGE}`);
            if (!pull.ok) {
                return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` };
            }
            const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {});
            trackChild(this.children, this.planKey(plan), handle);
            return { ok: true, handle };
        }
        if (plan.kind === 'process') {
            const engineDir = platform?.engineDirectory;
            // The binary plan runs the strata command (on the PATH after the install
            // script), so its build step is the one-line install. The source-build
            // plan runs setup.sh in the checkout, so its build step is the git sync
            // plus the engine's own setup.sh (the acquisition build steps), and the
            // launch resolves setup.sh to an absolute path in that checkout.
            const isBinary = plan.argv?.[0] === 'strata';
            let buildLogs = '';
            if (isBinary) {
                // The install script downloads the Terminal: the card's button reads
                // "Downloading..." for it.
                onProgress?.('download');
                const install = await this.host.run(STRATA_BINARY_INSTALL);
                if (!install.ok) {
                    return { ok: false, detail: `strata install failed: ${install.detail ?? 'unknown'}` };
                }
            }
            else {
                // The source build needs the checkout directory to resolve setup.sh;
                // without it the launch cannot find the engine.
                if (engineDir === undefined) {
                    return {
                        ok: false,
                        detail: 'the source build needs an engine directory (the Get step checkout) to run setup.sh',
                    };
                }
                if (options?.autoRebuild !== false) {
                    onProgress?.('download');
                    const sync = await syncAndRebuildEngine(this.host, {
                        engineId: this.id,
                        directory: engineDir,
                        ...(platform?.engineFork !== undefined ? { fork: platform.engineFork } : {}),
                        ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
                        ...(platform?.buildCommands !== undefined
                            ? { buildCommands: platform.buildCommands }
                            : {}),
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
            }
            const withLogs = (result) => buildLogs !== '' ? { ...result, logs: buildLogs } : result;
            // The source-build plan names setup.sh relative to the checkout; resolve
            // it to an absolute path so spawn finds it (spawn resolves a bare name
            // against PATH, not the cwd). The binary plan's strata is on the PATH, so
            // it spawns as-is.
            const argv = plan.argv ?? [];
            const spawnArgv = !isBinary && engineDir !== undefined
                ? [join(engineDir, argv[0] ?? 'setup.sh'), ...argv.slice(1)]
                : argv;
            const handle = this.host.spawn(spawnArgv, plan.env ?? {}, engineDir);
            trackChild(this.children, this.planKey(plan), handle);
            return withLogs({ ok: true, handle });
        }
        // A compose plan is a no-op for Strata.
        return { ok: true };
    }
    async healthCheck(plan, options) {
        // The Strata Terminal downloads its engine and the model files before it
        // can serve, so the health endpoint is not up for a long time (the model
        // download can be tens of gigabytes). A plain poll times out and reads the
        // start as broken, so this poll reads the tracked process's output and
        // reports the start phase: a 200 is ready, a process that ended before
        // readiness is failed, and a process still fetching its files after the
        // attempt cap is downloading (in progress, not a failure) so the card
        // re-polls instead of showing a broken launch.
        const pollMs = options?.pollMs ?? 1000;
        const maxAttempts = options?.maxAttempts ?? 120;
        let last = { status: 0, ok: false };
        let lastPreReady = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            last = await this.host.fetch(plan.healthUrl);
            if (last.status === 200) {
                return { healthy: true, status: 200, state: 'ready' };
            }
            // A running tracked process reports its start phase from its output. A
            // missing handle (no deploy tracked one, or the process already ended)
            // falls through to the plain poll: the health URL stays down, so the
            // loop times out and reads the start as failed.
            const handle = this.children.get(this.planKey(plan));
            if (handle !== undefined) {
                lastPreReady = strataPreReadyState(handle.logs ?? '');
            }
            if (pollMs > 0 && attempt < maxAttempts) {
                await delay(pollMs);
            }
        }
        // The engine did not report ready within the attempt cap. If it was still
        // downloading its files, read the start as in progress (downloading): the
        // download is not a broken launch, and the card re-polls until the engine
        // reports ready. If the download was done and the engine was starting,
        // read the start as failed (a stuck start timed out).
        if (lastPreReady === 'downloading') {
            return {
                healthy: false,
                status: last.status,
                state: 'downloading',
                detail: 'the engine is still downloading its model files',
            };
        }
        return {
            healthy: false,
            status: last.status,
            state: 'failed',
            detail: `health check did not return 200 within ${maxAttempts} attempts`,
        };
    }
    async stop(plan) {
        if (plan.kind === 'docker' && plan.containerName !== undefined) {
            await this.host.run(`docker stop ${plan.containerName}`);
        }
        // The binary plan stops through the strata command; the source-build plan
        // has no strata command, so it stops by signalling the tracked process.
        if (plan.kind === 'process' && plan.argv?.[0] === 'strata') {
            await this.host.run('strata launch --stop');
        }
        const handle = this.children.get(this.planKey(plan));
        if (handle !== undefined) {
            handle.kill();
            this.children.delete(this.planKey(plan));
        }
    }
    buildMode(config) {
        const mode = config.buildMode;
        if (mode === 'docker' || mode === 'local' || mode === 'binary') {
            return mode;
        }
        // The binary install is the README's one-line path (the one docs/AI_SETUP.md
        // walks an agent through), so a bare config renders the binary plan.
        return 'binary';
    }
    port(config) {
        return typeof config.port === 'number' ? config.port : 8080;
    }
    planKey(plan) {
        return `${plan.engineId}:${plan.port}`;
    }
}
//# sourceMappingURL=strataAdapter.js.map