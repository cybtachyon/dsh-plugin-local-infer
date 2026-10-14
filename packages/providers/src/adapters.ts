/**
 * The concrete engine adapters: NInfer (docker and local) and Hyper-Qwen
 * (compose). Each composes the provider `ParameterSpec` data into a
 * `LaunchPlan` and drives its deploy, health-check, and stop steps through an
 * injectable `LifecycleHost`, so the tests stub the host and never run a real
 * build, docker, or network in CI. The node implementation
 * (`nodeLifecycleHost`) is what the service wires in on a live host.
 * @module @dsh/dsh-plugin-local-infer/providers/adapters
 */

import { exec, spawn as nodeSpawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { EngineAdapter } from '../../core/lib/index.js'
import type {
  CommandOutcome,
  Config,
  DeployResult,
  EngineLaunchSignature,
  EnginePlatformConfig,
  FetchResult,
  HealthCheckOptions,
  HealthResult,
  HardwareProfile,
  LaunchPlan,
  LifecycleHost,
  ParameterSpec,
  ProcessHandle,
} from '../../core/lib/index.js'
import { NINFER_PARAMETERS } from './ninfer.ts'
import { HYPERQWEN_PARAMETERS } from './hyperqwen.ts'
import {
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from './llamacpp.ts'
import type { LlamaCppModelArtifact } from './llamacpp.ts'
import { STRATA_PARAMETERS } from './strata.ts'

/**
 * NInferModelArtifact is the per-model deploy data: the `.ninfer` artifact
 * file, the Hugging Face repo the model download pulls it from, and the
 * `--model-id` alias the server advertises. The data is the surface; adding a
 * model is a data edit here, never an adapter rewire.
 */
export interface NInferModelArtifact {
  file: string
  repo: string
  modelId: string
}

/**
 * The NInfer model artifacts, keyed by the model registry id. The 27B entry
 * is the default the DEFAULT_MODELS list names; the 35B-A3B entries are the
 * Qwen3.8 measured artifact (`qwen3-35b`) and the Qwen3.6 default
 * (`qwen36-35b`).
 */
export const NINFER_MODEL_ARTIFACTS: Record<string, NInferModelArtifact> = {
  'qwen3-27b': {
    file: 'qwen3_8_27b_nvfp4.ninfer',
    repo: 'neroued/Qwen3.8-27B-nvfp4-NInfer',
    modelId: 'Qwen3.8-27B',
  },
  'qwen3-35b': {
    file: 'qwen3_8_35b_a3b.ninfer',
    repo: 'Neroued/Qwen3.8-35B-A3B-NInfer',
    modelId: 'Qwen3.8-35B-A3B',
  },
  'qwen36-35b': {
    file: 'qwen3_6_35b_a3b.ninfer',
    repo: 'neroued/Qwen3.6-35B-A3B-NInfer',
    modelId: 'Qwen3.6-35B-A3B',
  },
}

/**
 * artifactFor resolves the artifact a model id deploys. An id no entry names
 * falls back to the 27B artifact, so a bare config always renders a plan.
 */
function artifactFor(modelId: string | undefined): NInferModelArtifact {
  const artifact = modelId !== undefined ? NINFER_MODEL_ARTIFACTS[modelId] : undefined
  return artifact ?? NINFER_MODEL_ARTIFACTS['qwen3-27b']!
}

/**
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing.
 */
export function flagsFromSpecs(
  specs: readonly ParameterSpec[],
  config: Config,
): string[] {
  const flags: string[] = []
  for (const spec of specs) {
    if (spec.toArgv === undefined) continue
    const value = config[spec.key] ?? spec.defaultValue
    if (value === undefined) continue
    flags.push(...spec.toArgv(value))
  }
  return flags
}

/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export function envFromSpecs(
  specs: readonly ParameterSpec[],
  config: Config,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const spec of specs) {
    if (spec.toEnv === undefined) continue
    const value = config[spec.key] ?? spec.defaultValue
    if (value === undefined) continue
    const [key, valueString] = spec.toEnv(value)
    env[key] = valueString
  }
  return env
}

/**
 * The node `LifecycleHost`: `run` through the system shell (a 10-minute cap, so
 * a hung CUDA build cannot hang the panel), `spawn` a detached child the stop
 * step can signal, and `fetch` the health URL. A fetch that throws (no route,
 * connection refused) reads as status 0, which the poll treats as not-ready.
 */
export const nodeLifecycleHost: LifecycleHost = {
  async run(command: string): Promise<CommandOutcome> {
    return new Promise(resolve => {
      exec(command, { timeout: 600_000 }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true })
          return
        }
        const detail = `${stderr ?? ''}${stdout ?? ''}${String(error)}`.trim().slice(-1024)
        resolve({ ok: false, detail })
      })
    })
  },
  spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle {
    const child = nodeSpawn(argv[0] ?? '', argv.slice(1), {
      env: { ...process.env, ...env },
      cwd,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return {
      pid: child.pid ?? -1,
      kill: (): void => {
        child.kill('SIGTERM')
      },
    }
  },
  async fetch(url: string): Promise<FetchResult> {
    try {
      const response = await fetch(url)
      return { status: response.status, ok: response.ok }
    } catch {
      return { status: 0, ok: false }
    }
  },
}

/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep.
 */
export async function pollHealth(
  host: LifecycleHost,
  plan: LaunchPlan,
  options?: HealthCheckOptions,
): Promise<HealthResult> {
  const pollMs = options?.pollMs ?? 1000
  const maxAttempts = options?.maxAttempts ?? 120
  let last: FetchResult = { status: 0, ok: false }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await host.fetch(plan.healthUrl)
    if (last.status === 200) {
      return { healthy: true, status: 200 }
    }
    if (pollMs > 0 && attempt < maxAttempts) {
      await delay(pollMs)
    }
  }
  return {
    healthy: false,
    status: last.status,
    detail: `health check did not return 200 within ${maxAttempts} attempts`,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * The NInfer docker image the adapter pulls and runs. The engineFork platform
 * config overrides the git source for a local build; the image stays the
 * upstream ghcr artifact.
 */
export const NINFER_DOCKER_IMAGE = 'ghcr.io/iamwavecut/ninfer-all'

/**
 * NInferAdapter is the canonical both-capable engine. `renderLaunch` renders a
 * local `ninfer-serve` process or a `docker run` of the ghcr image from the
 * same spec surface; `deploy` builds the engine in the engine directory (or
 * pulls the image), downloads the model into the model directory, and starts
 * the engine; `healthCheck` polls the health URL; `stop` signals the tracked
 * process and stops the named container.
 */
export class NInferAdapter extends EngineAdapter {
  readonly id = 'ninfer'
  readonly supports = { docker: true, local: true }
  private readonly host: LifecycleHost
  private readonly children = new Map<string, ProcessHandle>()

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return NINFER_PARAMETERS
  }

  override modelRef(config: Config): { id: string; name: string } {
    // The id the engine advertises on its OpenAI endpoint is the artifact's
    // --model-id alias, not the VramModel registry key the config names, so
    // the registrar publishes the alias and a chat turn routes to it.
    const artifact = artifactFor(typeof config.model === 'string' ? config.model : 'qwen3-27b')
    return { id: artifact.modelId, name: artifact.modelId }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The local plan runs the ninfer-serve binary; the docker plan's host
    // process is docker run of the ghcr image, so the image name is the
    // command-line marker the reserve probe matches on.
    const port = this.port(config)
    if (this.buildMode(config) === 'docker') {
      return { binary: NINFER_DOCKER_IMAGE, port }
    }
    return { binary: 'ninfer-serve', port }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const modelId = typeof config.model === 'string' ? config.model : 'qwen3-27b'
    const artifact = artifactFor(modelId)
    // A model key that names a local artifact file (a directory-scanned
    // model) overrides the artifact map's file, so a file the user has on
    // disk launches as-is.
    const file = modelId.endsWith('.ninfer') ? modelId : artifact.file
    const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : ''
    const flags = flagsFromSpecs(NINFER_PARAMETERS, config)
    if (this.buildMode(config) === 'docker') {
      const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
      const containerModelPath = `/models/${basename(file)}`
      const modelMount =
        modelDirectory === ''
          ? `${file}:${containerModelPath}`
          : `${dirname(modelPath)}:/models`
      const containerName = `ninfer-${port}`
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
      }
    }
    const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
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
    }
  }

  async deploy(plan: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult> {
    if (plan.kind === 'process') {
      const engineDir = platform?.engineDirectory
      if (engineDir !== undefined) {
        const fork = platform?.engineFork
        if (fork !== undefined) {
          const clone = await this.host.run(`git clone ${fork} ${engineDir}`)
          if (!clone.ok) {
            return { ok: false, detail: `git clone failed: ${clone.detail ?? 'unknown'}` }
          }
        }
        const build = await this.host.run(
          `cmake -S ${engineDir} -B ${engineDir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && ` +
            `cmake --build ${engineDir}/build -j`,
        )
        if (!build.ok) {
          return { ok: false, detail: `build failed: ${build.detail ?? 'unknown'}` }
        }
      }
      const download = await this.downloadModel(plan)
      if (!download.ok) return download
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
      this.children.set(this.planKey(plan), handle)
      return { ok: true }
    }
    if (plan.kind === 'docker') {
      const pull = await this.host.run(`docker pull ${NINFER_DOCKER_IMAGE}`)
      if (!pull.ok) {
        return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
      }
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
      this.children.set(this.planKey(plan), handle)
      return { ok: true }
    }
    // NInfer renders process and docker plans; a compose plan is a no-op.
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    if (plan.kind === 'docker' && plan.containerName !== undefined) {
      await this.host.run(`docker stop ${plan.containerName}`)
    }
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
    }
  }

  private buildMode(config: Config): 'docker' | 'local' {
    return config.buildMode === 'docker' ? 'docker' : 'local'
  }

  private port(config: Config): number {
    return typeof config.port === 'number' ? config.port : 18020
  }

  private planKey(plan: LaunchPlan): string {
    return `${plan.engineId}:${plan.port}`
  }

  private async downloadModel(plan: LaunchPlan): Promise<DeployResult> {
    const artifact = plan.modelId !== undefined ? NINFER_MODEL_ARTIFACTS[plan.modelId] : undefined
    if (artifact === undefined) return { ok: true }
    const target = plan.modelDirectory ?? '.'
    const download = await this.host.run(
      `hf download ${artifact.repo} ${artifact.file} --local-dir ${target}`,
    )
    if (!download.ok) {
      return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }
}

/**
 * HyperQwenAdapter is the docker-compose engine. `renderLaunch` renders a
 * compose plan (the compose file, the profile, and the `.env` the spec surface
 * maps to); `deploy` runs `docker compose up`; `healthCheck` polls the health
 * URL; `stop` runs `docker compose down`.
 */
export class HyperQwenAdapter extends EngineAdapter {
  readonly id = 'hyperqwen'
  readonly supports = { docker: true, local: false }
  private readonly host: LifecycleHost

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return HYPERQWEN_PARAMETERS
  }

  override modelRef(_config: Config): { id: string; name: string } {
    // vLLM serves the model under the name the compose file passes, and the
    // plugin tracks no per-model data for Hyper-Qwen yet, so the engine id is
    // the stable entry the registrar publishes until that data lands.
    return { id: 'hyperqwen', name: 'Hyper-Qwen' }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The compose host process is `docker compose ... up`, so the marker is
    // the command, not an image. The toEnv keys (SPEC, CTX, KV, ...) name the
    // .env the compose file reads, not the host process env, so they ride
    // along as the env-key element the matcher checks when a process line
    // carries env data.
    const port = this.port(config)
    const envKeys = Object.keys(envFromSpecs(HYPERQWEN_PARAMETERS, config))
    return { binary: 'docker compose', port, envKeys }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const profile = this.profile(config)
    const env = envFromSpecs(HYPERQWEN_PARAMETERS, config)
    const composeFile =
      typeof config.composeFile === 'string' ? config.composeFile : 'docker-compose.yml'
    return {
      engineId: this.id,
      kind: 'compose',
      env,
      composeFile,
      profile,
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(plan: LaunchPlan): Promise<DeployResult> {
    const up = await this.host.run(
      `docker compose -f ${plan.composeFile} --profile ${plan.profile} up --pull always -d`,
    )
    if (!up.ok) {
      return { ok: false, detail: `compose up failed: ${up.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    await this.host.run(`docker compose -f ${plan.composeFile} --profile ${plan.profile} down`)
  }

  private port(config: Config): number {
    return typeof config.port === 'number' ? config.port : 18020
  }

  private profile(config: Config): string {
    return typeof config.profile === 'string' ? config.profile : 'single'
  }
}

/**
 * The llama.cpp docker image the adapter pulls and runs. The engineFork
 * platform config overrides the git source for a local build; the image stays
 * the upstream ggml artifact.
 */
export const LLAMACPP_DOCKER_IMAGE = 'ghcr.io/ggml-org/llama.cpp'

/**
 * llamaCppArtifact resolves the artifact a model key deploys. A key no entry
 * names falls back to the 27B artifact, so a bare config always renders a plan.
 */
function llamaCppArtifact(modelKey: string | undefined): LlamaCppModelArtifact {
  const artifact = modelKey !== undefined ? LLAMACPP_MODEL_ARTIFACTS[modelKey] : undefined
  return artifact ?? LLAMACPP_MODEL_ARTIFACTS['qwen3-27b']!
}

/**
 * LlamaCppAdapter is the llama.cpp engine, both-capable like NInfer.
 * `renderLaunch` renders a local `llama-server` process or a `docker run` of the
 * ggml image from the same `LLAMACPP_PARAMETERS` surface; `deploy` builds the
 * engine in the engine directory (or pulls the image), downloads the GGUF model
 * into the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process and stops the named container.
 */
export class LlamaCppAdapter extends EngineAdapter {
  readonly id = 'llamacpp'
  readonly supports = { docker: true, local: true }
  private readonly host: LifecycleHost
  private readonly children = new Map<string, ProcessHandle>()

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return LLAMACPP_PARAMETERS
  }

  override modelRef(config: Config): { id: string; name: string } {
    // The engine serves the model under the artifact's advertised id, so the
    // registrar publishes that alias and a chat turn routes to it.
    const artifact = llamaCppArtifact(llamaCppModelKey(config))
    return { id: artifact.modelId, name: artifact.modelId }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The local plan runs the llama-server binary; the docker plan's host
    // process is docker run of the ggml image, so the image name is the
    // command-line marker the reserve probe matches on.
    const port = this.port(config)
    if (this.buildMode(config) === 'docker') {
      return { binary: LLAMACPP_DOCKER_IMAGE, port }
    }
    return { binary: 'llama-server', port }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const modelId = llamaCppModelKey(config)
    const artifact = llamaCppArtifact(modelId)
    // A model key that names a local GGUF file (a directory-scanned model)
    // overrides the artifact map's file, so a file the user has on disk
    // launches as-is.
    const file = modelId.endsWith('.gguf') ? modelId : artifact.file
    const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : ''
    const flags = flagsFromSpecs(LLAMACPP_PARAMETERS, config)
    if (this.buildMode(config) === 'docker') {
      const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
      const containerModelPath = `/models/${basename(file)}`
      const modelMount =
        modelDirectory === ''
          ? `${file}:${containerModelPath}`
          : `${dirname(modelPath)}:/models`
      const containerName = `llamacpp-${port}`
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
          '-v',
          modelMount,
          LLAMACPP_DOCKER_IMAGE,
          '--model',
          containerModelPath,
          ...flags,
        ],
        env: {},
        containerName,
        modelId,
        ...(modelDirectory === '' ? {} : { modelDirectory }),
        port,
        healthUrl: `http://127.0.0.1:${port}/health`,
      }
    }
    const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
    return {
      engineId: this.id,
      kind: 'process',
      argv: [
        'llama-server',
        '--model',
        modelPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        ...flags,
      ],
      env: {},
      modelId,
      ...(modelDirectory === '' ? {} : { modelDirectory }),
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(plan: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult> {
    if (plan.kind === 'process') {
      const engineDir = platform?.engineDirectory
      if (engineDir !== undefined) {
        const fork = platform?.engineFork
        if (fork !== undefined) {
          const clone = await this.host.run(`git clone ${fork} ${engineDir}`)
          if (!clone.ok) {
            return { ok: false, detail: `git clone failed: ${clone.detail ?? 'unknown'}` }
          }
        }
        const build = await this.host.run(
          `cmake -S ${engineDir} -B ${engineDir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && ` +
            `cmake --build ${engineDir}/build -j`,
        )
        if (!build.ok) {
          return { ok: false, detail: `build failed: ${build.detail ?? 'unknown'}` }
        }
      }
      const download = await this.downloadModel(plan)
      if (!download.ok) return download
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
      this.children.set(this.planKey(plan), handle)
      return { ok: true }
    }
    if (plan.kind === 'docker') {
      const pull = await this.host.run(`docker pull ${LLAMACPP_DOCKER_IMAGE}`)
      if (!pull.ok) {
        return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
      }
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
      this.children.set(this.planKey(plan), handle)
      return { ok: true }
    }
    // llama.cpp renders process and docker plans; a compose plan is a no-op.
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    if (plan.kind === 'docker' && plan.containerName !== undefined) {
      await this.host.run(`docker stop ${plan.containerName}`)
    }
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
    }
  }

  private buildMode(config: Config): 'docker' | 'local' {
    return config.buildMode === 'docker' ? 'docker' : 'local'
  }

  private port(config: Config): number {
    return typeof config.port === 'number' ? config.port : 8080
  }

  private planKey(plan: LaunchPlan): string {
    return `${plan.engineId}:${plan.port}`
  }

  private async downloadModel(plan: LaunchPlan): Promise<DeployResult> {
    const artifact = plan.modelId !== undefined ? LLAMACPP_MODEL_ARTIFACTS[plan.modelId] : undefined
    if (artifact === undefined) return { ok: true }
    const target = plan.modelDirectory ?? '.'
    const download = await this.host.run(
      `hf download ${artifact.repo} ${artifact.file} --local-dir ${target}`,
    )
    if (!download.ok) {
      return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }
}

/**
 * The Strata docker image the adapter pulls and runs. Strata is the
 * placeholder engine: the image and the parameter data land when the engine
 * is available, and the adapter renders a bare docker plan until then.
 */
export const STRATA_DOCKER_IMAGE = 'ghcr.io/strata/strata'

/**
 * StrataAdapter is the placeholder docker-only engine. `renderLaunch` renders
 * a `docker run` of the Strata image (no spec surface yet, so no flags);
 * `deploy` pulls the image and starts the container; `healthCheck` polls the
 * health URL; `stop` stops the named container. The parameter surface and the
 * per-model data land with the engine, as data edits, never an adapter rewire.
 */
export class StrataAdapter extends EngineAdapter {
  readonly id = 'strata'
  readonly supports = { docker: true, local: false }
  private readonly host: LifecycleHost
  private readonly children = new Map<string, ProcessHandle>()

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return STRATA_PARAMETERS
  }

  override modelRef(_config: Config): { id: string; name: string } {
    // Strata serves the model under the name the container passes, and the
    // plugin tracks no per-model data for Strata yet, so the engine id is the
    // stable entry the registrar publishes until that data lands.
    return { id: 'strata', name: 'Strata' }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // Strata is docker-only, so the signature is the image name the docker
    // run carries plus the port the plan binds.
    return { binary: STRATA_DOCKER_IMAGE, port: this.port(config) }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const containerName = `strata-${port}`
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
        STRATA_DOCKER_IMAGE,
      ],
      env: {},
      containerName,
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(plan: LaunchPlan): Promise<DeployResult> {
    const pull = await this.host.run(`docker pull ${STRATA_DOCKER_IMAGE}`)
    if (!pull.ok) {
      return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
    }
    const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
    this.children.set(this.planKey(plan), handle)
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    if (plan.containerName !== undefined) {
      await this.host.run(`docker stop ${plan.containerName}`)
    }
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
    }
  }

  private port(config: Config): number {
    return typeof config.port === 'number' ? config.port : 8080
  }

  private planKey(plan: LaunchPlan): string {
    return `${plan.engineId}:${plan.port}`
  }
}
