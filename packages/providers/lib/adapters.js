/**
 * The concrete engine adapters: NInfer (docker and local) and Hyper-Qwen
 * (compose). Each composes the provider `ParameterSpec` data into a
 * `LaunchPlan` and drives its deploy, health-check, and stop steps through an
 * injectable `LifecycleHost`, so the tests stub the host and never run a real
 * build, docker, or network in CI. The node implementation
 * (`nodeLifecycleHost`) is what the service wires in on a live host.
 * @module @dsh/dsh-plugin-local-infer/providers/adapters
 */
import { exec, spawn as nodeSpawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { EngineAdapter } from '../../core/lib/index.js';
import { NINFER_PARAMETERS } from "./ninfer.js";
import { HYPERQWEN_PARAMETERS } from "./hyperqwen.js";
/**
 * The NInfer model artifacts, keyed by the VramModel registry id. The 27B
 * entry is the artifact the qwen-ninfer launcher downloads; the 35B entry is
 * the 35B-A3B companion-weight artifact.
 */
export const NINFER_MODEL_ARTIFACTS = {
    'qwen3-27b': {
        file: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
        repo: 'kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
        modelId: 'Qwen3.8-27B',
    },
    'qwen3-35b': {
        file: 'qwen3_8_35b_a3b.ninfer',
        repo: 'Neroued/Qwen3.8-35B-A3B-NInfer',
        modelId: 'Qwen3.8-35B-A3B',
    },
};
/**
 * artifactFor resolves the artifact a model id deploys. An id no entry names
 * falls back to the 27B artifact, so a bare config always renders a plan.
 */
function artifactFor(modelId) {
    const artifact = modelId !== undefined ? NINFER_MODEL_ARTIFACTS[modelId] : undefined;
    return artifact ?? NINFER_MODEL_ARTIFACTS['qwen3-27b'];
}
/**
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing.
 */
export function flagsFromSpecs(specs, config) {
    const flags = [];
    for (const spec of specs) {
        if (spec.toArgv === undefined)
            continue;
        const value = config[spec.key] ?? spec.defaultValue;
        if (value === undefined)
            continue;
        flags.push(...spec.toArgv(value));
    }
    return flags;
}
/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export function envFromSpecs(specs, config) {
    const env = {};
    for (const spec of specs) {
        if (spec.toEnv === undefined)
            continue;
        const value = config[spec.key] ?? spec.defaultValue;
        if (value === undefined)
            continue;
        const [key, valueString] = spec.toEnv(value);
        env[key] = valueString;
    }
    return env;
}
/**
 * The node `LifecycleHost`: `run` through the system shell (a 10-minute cap, so
 * a hung CUDA build cannot hang the panel), `spawn` a detached child the stop
 * step can signal, and `fetch` the health URL. A fetch that throws (no route,
 * connection refused) reads as status 0, which the poll treats as not-ready.
 */
export const nodeLifecycleHost = {
    async run(command) {
        return new Promise(resolve => {
            exec(command, { timeout: 600_000 }, (error, stdout, stderr) => {
                if (error === null) {
                    resolve({ ok: true });
                    return;
                }
                const detail = `${stderr ?? ''}${stdout ?? ''}${String(error)}`.trim().slice(-1024);
                resolve({ ok: false, detail });
            });
        });
    },
    spawn(argv, env, cwd) {
        const child = nodeSpawn(argv[0] ?? '', argv.slice(1), {
            env: { ...process.env, ...env },
            cwd,
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        return {
            pid: child.pid ?? -1,
            kill: () => {
                child.kill('SIGTERM');
            },
        };
    },
    async fetch(url) {
        try {
            const response = await fetch(url);
            return { status: response.status, ok: response.ok };
        }
        catch {
            return { status: 0, ok: false };
        }
    },
};
/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep.
 */
export async function pollHealth(host, plan, options) {
    const pollMs = options?.pollMs ?? 1000;
    const maxAttempts = options?.maxAttempts ?? 120;
    let last = { status: 0, ok: false };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        last = await host.fetch(plan.healthUrl);
        if (last.status === 200) {
            return { healthy: true, status: 200 };
        }
        if (pollMs > 0 && attempt < maxAttempts) {
            await delay(pollMs);
        }
    }
    return {
        healthy: false,
        status: last.status,
        detail: `health check did not return 200 within ${maxAttempts} attempts`,
    };
}
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
/**
 * The NInfer docker image the adapter pulls and runs. The engineFork platform
 * config overrides the git source for a local build; the image stays the
 * upstream ghcr artifact.
 */
export const NINFER_DOCKER_IMAGE = 'ghcr.io/iamwavecut/ninfer-all';
/**
 * NInferAdapter is the canonical both-capable engine. `renderLaunch` renders a
 * local `ninfer-serve` process or a `docker run` of the ghcr image from the
 * same spec surface; `deploy` builds the engine in the engine directory (or
 * pulls the image), downloads the model into the model directory, and starts
 * the engine; `healthCheck` polls the health URL; `stop` signals the tracked
 * process and stops the named container.
 */
export class NInferAdapter extends EngineAdapter {
    id = 'ninfer';
    supports = { docker: true, local: true };
    host;
    children = new Map();
    constructor(host = nodeLifecycleHost) {
        super();
        this.host = host;
    }
    parameters() {
        return NINFER_PARAMETERS;
    }
    renderLaunch(config, _hw) {
        const port = this.port(config);
        const modelId = typeof config.model === 'string' ? config.model : 'qwen3-27b';
        const artifact = artifactFor(modelId);
        const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : '';
        const flags = flagsFromSpecs(NINFER_PARAMETERS, config);
        if (this.buildMode(config) === 'docker') {
            const modelPath = modelDirectory === '' ? artifact.file : join(modelDirectory, artifact.file);
            const containerModelPath = `/models/${basename(artifact.file)}`;
            const modelMount = modelDirectory === ''
                ? `${artifact.file}:${containerModelPath}`
                : `${dirname(modelPath)}:/models`;
            const containerName = `ninfer-${port}`;
            return {
                engineId: this.id,
                kind: 'docker',
                argv: [
                    'docker',
                    'run',
                    '--rm',
                    '--gpus',
                    'all',
                    '--name',
                    containerName,
                    '-p',
                    `127.0.0.1:${port}:8080`,
                    '--ulimit',
                    'memlock=-1',
                    '-v',
                    'ninfer-cache:/cache',
                    '-v',
                    modelMount,
                    NINFER_DOCKER_IMAGE,
                    'serve',
                    containerModelPath,
                    '--model-id',
                    artifact.modelId,
                    ...flags,
                ],
                env: {},
                containerName,
                modelId,
                ...(modelDirectory === '' ? {} : { modelDirectory }),
                port,
                healthUrl: `http://127.0.0.1:${port}/health`,
            };
        }
        const modelPath = modelDirectory === '' ? artifact.file : join(modelDirectory, artifact.file);
        return {
            engineId: this.id,
            kind: 'process',
            argv: [
                'ninfer-serve',
                modelPath,
                '--host',
                '127.0.0.1',
                '--port',
                String(port),
                '--model-id',
                artifact.modelId,
                ...flags,
            ],
            env: {},
            modelId,
            ...(modelDirectory === '' ? {} : { modelDirectory }),
            port,
            healthUrl: `http://127.0.0.1:${port}/health`,
        };
    }
    async deploy(plan, platform) {
        if (plan.kind === 'process') {
            const engineDir = platform?.engineDirectory;
            if (engineDir !== undefined) {
                const fork = platform?.engineFork;
                if (fork !== undefined) {
                    const clone = await this.host.run(`git clone ${fork} ${engineDir}`);
                    if (!clone.ok) {
                        return { ok: false, detail: `git clone failed: ${clone.detail ?? 'unknown'}` };
                    }
                }
                const build = await this.host.run(`cmake -S ${engineDir} -B ${engineDir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && ` +
                    `cmake --build ${engineDir}/build -j`);
                if (!build.ok) {
                    return { ok: false, detail: `build failed: ${build.detail ?? 'unknown'}` };
                }
            }
            const download = await this.downloadModel(plan);
            if (!download.ok)
                return download;
            const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir);
            this.children.set(this.planKey(plan), handle);
            return { ok: true };
        }
        if (plan.kind === 'docker') {
            const pull = await this.host.run(`docker pull ${NINFER_DOCKER_IMAGE}`);
            if (!pull.ok) {
                return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` };
            }
            const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {});
            this.children.set(this.planKey(plan), handle);
            return { ok: true };
        }
        // NInfer renders process and docker plans; a compose plan is a no-op.
        return { ok: true };
    }
    async healthCheck(plan, options) {
        return pollHealth(this.host, plan, options);
    }
    async stop(plan) {
        if (plan.kind === 'docker' && plan.containerName !== undefined) {
            await this.host.run(`docker stop ${plan.containerName}`);
        }
        const handle = this.children.get(this.planKey(plan));
        if (handle !== undefined) {
            handle.kill();
            this.children.delete(this.planKey(plan));
        }
    }
    buildMode(config) {
        return config.buildMode === 'docker' ? 'docker' : 'local';
    }
    port(config) {
        return typeof config.port === 'number' ? config.port : 18020;
    }
    planKey(plan) {
        return `${plan.engineId}:${plan.port}`;
    }
    async downloadModel(plan) {
        const artifact = plan.modelId !== undefined ? NINFER_MODEL_ARTIFACTS[plan.modelId] : undefined;
        if (artifact === undefined)
            return { ok: true };
        const target = plan.modelDirectory ?? '.';
        const download = await this.host.run(`hf download ${artifact.repo} ${artifact.file} --local-dir ${target}`);
        if (!download.ok) {
            return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` };
        }
        return { ok: true };
    }
}
/**
 * HyperQwenAdapter is the docker-compose engine. `renderLaunch` renders a
 * compose plan (the compose file, the profile, and the `.env` the spec surface
 * maps to); `deploy` runs `docker compose up`; `healthCheck` polls the health
 * URL; `stop` runs `docker compose down`.
 */
export class HyperQwenAdapter extends EngineAdapter {
    id = 'hyperqwen';
    supports = { docker: true, local: false };
    host;
    constructor(host = nodeLifecycleHost) {
        super();
        this.host = host;
    }
    parameters() {
        return HYPERQWEN_PARAMETERS;
    }
    renderLaunch(config, _hw) {
        const port = this.port(config);
        const profile = this.profile(config);
        const env = envFromSpecs(HYPERQWEN_PARAMETERS, config);
        const composeFile = typeof config.composeFile === 'string' ? config.composeFile : 'docker-compose.yml';
        return {
            engineId: this.id,
            kind: 'compose',
            env,
            composeFile,
            profile,
            port,
            healthUrl: `http://127.0.0.1:${port}/health`,
        };
    }
    async deploy(plan) {
        const up = await this.host.run(`docker compose -f ${plan.composeFile} --profile ${plan.profile} up --pull always -d`);
        if (!up.ok) {
            return { ok: false, detail: `compose up failed: ${up.detail ?? 'unknown'}` };
        }
        return { ok: true };
    }
    async healthCheck(plan, options) {
        return pollHealth(this.host, plan, options);
    }
    async stop(plan) {
        await this.host.run(`docker compose -f ${plan.composeFile} --profile ${plan.profile} down`);
    }
    port(config) {
        return typeof config.port === 'number' ? config.port : 18020;
    }
    profile(config) {
        return typeof config.profile === 'string' ? config.profile : 'single';
    }
}
//# sourceMappingURL=adapters.js.map