/**
 * The concrete engine adapters: NInfer (docker and local) and Hyper-Qwen
 * (compose). Each composes the provider `ParameterSpec` data into a
 * `LaunchPlan` and drives its deploy, health-check, and stop steps through an
 * injectable `LifecycleHost`, so the tests stub the host and never run a real
 * build, docker, or network in CI. The node implementation
 * (`nodeLifecycleHost`) is what the service wires in on a live host.
 * @module dsh-plugin-local-infer/providers/adapters
 */

import { exec, spawn as nodeSpawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { EngineAdapter, formatLaunchCommand } from '../../core/lib/index.js'
import type {
  CommandOutcome,
  Config,
  DebugLogger,
  DeployOptions,
  DeployResult,
  EngineLaunchSignature,
  EnginePlatformConfig,
  FetchResult,
  HealthCheckOptions,
  HealthResult,
  HardwareProfile,
  LaunchPlan,
  LaunchProgress,
  LifecycleHost,
  ParameterSpec,
  ProcessExitInfo,
  ProcessHandle,
} from '../../core/lib/index.js'
import { syncAndRebuildEngine } from './acquire.ts'
import { NINFER_PARAMETERS } from './ninfer.ts'
import { HYPERQWEN_PARAMETERS } from './hyperqwen.ts'
import {
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from './llamacpp.ts'
import type { LlamaCppModelArtifact } from './llamacpp.ts'
import {
  INFERNIX_MODEL_ARTIFACTS,
  INFERNIX_PARAMETERS,
  infernixArtifactFor,
  infernixDraftModelPath,
  infernixModelKey,
} from './infernix.ts'
export { INFERNIX_MODEL_ARTIFACTS } from './infernix.ts'
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
  // The Swift 1.5 ablated 27B the local launcher bootstraps: the nvfp4-full
  // DFlash2 artifact the qwen-ninfer script serves. It reuses the 27B model id
  // the engine advertises, so a chat turn routes to the same alias.
  'qwen3-27b-swift15': {
    file: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    repo: 'kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
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
 * customArgFlags turns the card's Custom Arguments rows (`config.customArgs`)
 * into the flat flag list the adapters append to the launch argv. Each row is
 * a key (a flag, e.g. `--kv-dtype`) and an optional value: a row with a value
 * contributes `[key, value]`, a bare row contributes `[key]`. A row with a
 * blank key contributes nothing, and a non-array `customArgs` (an older config
 * that predates the key) reads as no custom args, so an engine that never had
 * the section launches unchanged.
 */
export function customArgFlags(config: Config): string[] {
  const raw = config.customArgs
  if (!Array.isArray(raw)) return []
  const flags: string[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const key = (entry as { key?: unknown }).key
    if (typeof key !== 'string' || key.trim() === '') continue
    flags.push(key)
    const value = (entry as { value?: unknown }).value
    if (typeof value === 'string' && value !== '') {
      flags.push(value)
    }
  }
  return flags
}

/**
 * customArgEnv turns the card's Custom Arguments rows (`config.customArgs`)
 * into the environment map the compose adapter appends to the plan's env: each
 * row's key becomes an env var set to its value. A row with no value is skipped,
 * because an empty env var is not a meaningful override. A non-array
 * `customArgs` (an older config that predates the key) reads as no custom args.
 */
export function customArgEnv(config: Config): Record<string, string> {
  const raw = config.customArgs
  if (!Array.isArray(raw)) return {}
  const env: Record<string, string> = {}
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const key = (entry as { key?: unknown }).key
    const value = (entry as { value?: unknown }).value
    if (typeof key !== 'string' || key.trim() === '') continue
    if (typeof value !== 'string' || value === '') continue
    env[key] = value
  }
  return env
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
 * createNodeLifecycleHost builds the node `LifecycleHost`: `run` through the
 * system shell (a 10-minute cap, so a hung CUDA build cannot hang the panel),
 * `spawn` a detached child the stop step can signal, and `fetch` the health
 * URL. A fetch that throws (no route, connection refused) reads as status 0,
 * which the poll treats as not-ready. When `debug` is provided, the host logs
 * every command it issues (each `run` line and each `spawn` argv) through it,
 * so a DSH debug-mode host captures the full build-to-launch sequence.
 */
export function createNodeLifecycleHost(debug?: DebugLogger): LifecycleHost {
  // The debug logger is a no-op outside debug mode, so the guard reads as
  // "log when a real sink is wired" and the command path stays quiet otherwise.
  const log = debug ?? undefined
  return {
    async run(command: string): Promise<CommandOutcome> {
      log?.(`run: ${command}`)
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
    async runStream(command: string, onOutput: (chunk: string) => void): Promise<CommandOutcome> {
      log?.(`run: ${command}`)
      return new Promise(resolve => {
        // No overall timeout: a full CUDA build legitimately runs long, and
        // the card prices a stalled step with its own output-idle watchdog.
        const child = nodeSpawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        const append = (chunk: Buffer): void => {
          const text = chunk.toString('utf8')
          onOutput(text)
          output += text
          if (output.length > 2048) {
            output = output.slice(-1024)
          }
        }
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.on('error', error => {
          resolve({ ok: false, detail: error.message })
        })
        child.on('close', code => {
          if (code === 0) {
            resolve({ ok: true })
            return
          }
          resolve({ ok: false, detail: `exit ${code}: ${output.trim().slice(-1024)}` })
        })
      })
    },
    spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle {
      log?.(`spawn: ${argv.join(' ')}${cwd !== undefined ? ` (cwd: ${cwd})` : ''}`)
      const child = nodeSpawn(argv[0] ?? '', argv.slice(1), {
        env: { ...process.env, ...env },
        cwd,
        detached: true,
        // Pipe the child's stdout and stderr so the launch step can surface the
        // engine's log output in the card and write it to the configured log
        // file; stdin stays ignored.
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.unref()
      // Accumulate the child's output into a single string the handle exposes.
      // The cap keeps a chatty engine from growing the host's memory without
      // bound; the tail is what the log file and the card keep.
      let logs = ''
      const append = (chunk: Buffer): void => {
        logs = (logs + chunk.toString('utf8')).slice(-65536)
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      // An EventEmitter with no 'error' listener turns the event into a thrown
      // uncaughtException, which takes the DSH host down with it. A spawn that
      // cannot start (a missing engine binary, an ENOENT) and a stream that
      // breaks on a crashing child both emit 'error' here, so every path gets
      // a listener and the failure lands in the logs instead of the crash.
      child.stdout?.on('error', (error: Error) => {
        logs = (logs + `stdout error: ${error.message}\n`).slice(-65536)
      })
      child.stderr?.on('error', (error: Error) => {
        logs = (logs + `stderr error: ${error.message}\n`).slice(-65536)
      })
      // The one-shot exit contract: 'error' names a child that never ran,
      // 'exit' carries the code or signal, and 'close' follows once the pipes
      // drain. The first settled source wins, so the handle's onExit listener
      // (crash, pkill, or clean stop) fires exactly once with the detail.
      const listeners = new Set<(exit: ProcessExitInfo) => void>()
      let exitInfo: ProcessExitInfo | null = null
      const settle = (info: ProcessExitInfo): void => {
        if (exitInfo !== null) return
        exitInfo = info
        for (const listener of listeners) {
          try {
            listener(info)
          } catch {
            // A listener that throws must not re-raise into the child's event
            // pipeline and take the host down the way an unlistened 'error' did.
          }
        }
        listeners.clear()
      }
      let exitSignal: string | null = null
      child.on('error', (error: Error) => {
        logs = (logs + `spawn error: ${error.message}\n`).slice(-65536)
        // The error fires before the stdio drains; settle immediately so a
        // launch of a missing binary reports rather than hangs the watcher.
        settle({ code: null, signal: null, error: error.message })
      })
      child.on('exit', (_code, signal) => {
        exitSignal = signal
      })
      child.on('close', (code, signal) => {
        settle({ code, signal: signal ?? exitSignal })
      })
      return {
        pid: child.pid ?? -1,
        kill: (): void => {
          child.kill('SIGTERM')
        },
        get logs(): string {
          return logs
        },
        onExit: (listener: (exit: ProcessExitInfo) => void): void => {
          // A listener registered after the child already ended fires
          // immediately, so a late attach (the service wiring after deploy)
          // never misses the crash that landed in between.
          if (exitInfo !== null) {
            listener(exitInfo)
            return
          }
          listeners.add(listener)
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
    ...(log !== undefined ? { debug: log } : {}),
  }
}

/**
 * nodeLifecycleHost is the default live host the service wires in: the node
 * implementation with no debug logger, so a normal (non-debug) run logs no
 * commands. The providers' apply step swaps in a debug-aware host when DSH is
 * in debug mode.
 */
export const nodeLifecycleHost: LifecycleHost = createNodeLifecycleHost()

/**
 * trackChild stores a spawned handle in the adapter's children map and ties
 * the entry's lifetime to the child's: when the child ends (a crash, a pkill,
 * or the adapter's own stop kill) the entry is dropped, so a later stop never
 * signals a pid a recycled process has taken over. A handle whose host cannot
 * watch (onExit absent) stays tracked until stop removes it.
 */
function trackChild(
  children: Map<string, ProcessHandle>,
  key: string,
  handle: ProcessHandle,
): void {
  children.set(key, handle)
  handle.onExit?.(() => {
    // Compare identity before deleting: a newer launch that already replaced
    // this key's entry keeps its handle, and only the ended child's entry
    // goes.
    if (children.get(key) === handle) {
      children.delete(key)
    }
  })
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
      const customArgs = customArgFlags(config)
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
          ...customArgs,
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
    const customArgs = customArgFlags(config)
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
        ...customArgs,
      ],
      env: {},
      modelId,
      ...(modelDirectory === '' ? {} : { modelDirectory }),
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    options?: DeployOptions,
  ): Promise<DeployResult> {
    if (plan.kind === 'process') {
      const engineDir = platform?.engineDirectory
      let buildLogs = ''
      // Auto Rebuild off (the card's checkbox): the git sync (fetch, rebase,
      // rebuild) is skipped and the checkout launches as-is.
      if (engineDir !== undefined && options?.autoRebuild !== false) {
        // The git sync is the checkout download: the card's button reads
        // "Downloading..." for it, not "Building...".
        onProgress?.('download')
        // The conditional rebuild fetches the checkout, prices it against the
        // remote branch, and rebuilds only when it is behind (or a fresh
        // clone). The decision, the build command, and its output are captured
        // into buildLogs and threaded to the card's Logs section.
        const sync = await syncAndRebuildEngine(
          this.host,
          {
            engineId: this.id,
            directory: engineDir,
            ...(platform?.engineFork !== undefined ? { fork: platform.engineFork } : {}),
            ...(plan.argv?.[0] !== undefined ? { binary: plan.argv[0] } : {}),
            ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
          },
          () => {},
        )
        buildLogs = sync.logs
        if (!sync.ok) {
          return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs }
        }
        // The build step reads as "Building..." only when a build actually
        // ran (a fresh clone, or a rebase of a checkout that was behind).
        if (sync.rebuilt) {
          onProgress?.('build')
        }
      }
      const withLogs = (result: DeployResult): DeployResult =>
        buildLogs !== '' ? { ...result, logs: buildLogs } : result
      onProgress?.('download')
      const download = await this.downloadModel(plan)
      if (!download.ok) return withLogs(download)
      // A chat template the user picked as an HF repo reference (the combo
      // control's known choices) is not a path the engine can read, so the
      // deploy step downloads it into the model directory and rewrites the
      // --chat-template flag to the local file before the spawn.
      onProgress?.('download')
      const templateResult = await this.resolveChatTemplate(plan)
      if (!templateResult.ok) return withLogs(templateResult)
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
      trackChild(this.children, this.planKey(plan), handle)
      return withLogs({ ok: true, handle })
    }
    if (plan.kind === 'docker') {
      // The image pull is the docker build step: the card's button reads
      // "Building..." for it.
      onProgress?.('build')
      const pull = await this.host.run(`docker pull ${NINFER_DOCKER_IMAGE}`)
      if (!pull.ok) {
        return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
      }
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
      trackChild(this.children, this.planKey(plan), handle)
      return { ok: true, handle }
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

  /**
   * resolveChatTemplate rewrites a --chat-template flag that carries an HF repo
   * reference into the local file the engine reads. A value with a slash that
   * is not an absolute path (the combo control's known choices) is a repo the
   * deploy step downloads into the model directory; an already-local path is
   * left as-is. The download is best-effort: a template that is already on
   * disk is used without a re-fetch, and a missing hf CLI leaves the flag
   * untouched so the engine reports the missing template itself.
   */
  private async resolveChatTemplate(plan: LaunchPlan): Promise<DeployResult> {
    const argv = plan.argv
    if (argv === undefined) return { ok: true }
    const index = argv.indexOf('--chat-template')
    if (index === -1) return { ok: true }
    const value = argv[index + 1]
    if (value === undefined) return { ok: true }
    // An absolute path (a leading /) is already local; a value with no slash
    // is a bare file name the engine resolves against its own directory.
    if (value.startsWith('/') || !value.includes('/')) return { ok: true }
    // An HF repo reference: download the template file into the model
    // directory and point the flag at the local copy.
    const target = plan.modelDirectory ?? '.'
    const localPath = `${target.endsWith('/') ? '' : `${target}/`}chat_template.jinja`
    // A template already on disk skips the re-fetch; the hf CLI is optional,
    // so a download failure is reported but does not abort the launch.
    const probe = await this.host.run(`[ -f ${localPath} ]`)
    if (!probe.ok) {
      const download = await this.host.run(
        `hf download ${value} chat_template.jinja --local-dir ${target}`,
      )
      if (!download.ok) {
        return {
          ok: false,
          detail: `chat template download failed: ${download.detail ?? 'unknown'}`,
        }
      }
    }
    argv[index + 1] = localPath
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
    // The spec env and the card's Custom Arguments merge into one env map: the
    // spec keys are the .env the compose file reads, and the custom rows are
    // the user's own overrides appended after them.
    const env = { ...envFromSpecs(HYPERQWEN_PARAMETERS, config), ...customArgEnv(config) }
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

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    _options?: DeployOptions,
  ): Promise<DeployResult> {
    // The card's docker-tag field carries the compose arguments (the profile
    // the up step selects); the deploy step applies it to the plan so the up
    // line and the card's Logs section agree.
    if (platform?.dockerTag !== undefined) {
      plan.composeArgs = platform.dockerTag
    }
    // The core formatter is the single source of the compose up line: the
    // card's Logs section prints the same string this run gets.
    const command = formatLaunchCommand(plan)
    if (command === undefined) {
      return { ok: false, detail: 'compose plan carries no command' }
    }
    // The compose up is the docker build step: the card's button reads
    // "Building..." for it.
    onProgress?.('build')
    const up = await this.host.run(command)
    if (!up.ok) {
      return { ok: false, detail: `compose up failed: ${up.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    // The down step brings down the containers the up step started, so it
    // runs the same compose arguments (the profile the up selected); an
    // absent composeArgs falls back to the engine's default profile.
    const composeArgs = plan.composeArgs?.split(/\s+/).filter((token) => token !== '')
    const args =
      composeArgs !== undefined && composeArgs.length > 0
        ? composeArgs.join(' ')
        : `--profile ${plan.profile ?? 'single'}`
    await this.host.run(
      `docker compose -f ${plan.composeFile ?? 'docker-compose.yml'} ${args} down`,
    )
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
      const customArgs = customArgFlags(config)
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
          ...customArgs,
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
    const customArgs = customArgFlags(config)
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
        ...customArgs,
      ],
      env: {},
      modelId,
      ...(modelDirectory === '' ? {} : { modelDirectory }),
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    options?: DeployOptions,
  ): Promise<DeployResult> {
    if (plan.kind === 'process') {
      const engineDir = platform?.engineDirectory
      let buildLogs = ''
      // Auto Rebuild off (the card's checkbox): the git sync (fetch, rebase,
      // rebuild) is skipped and the checkout launches as-is.
      if (engineDir !== undefined && options?.autoRebuild !== false) {
        // The git sync is the checkout download: the card's button reads
        // "Downloading..." for it, not "Building...".
        onProgress?.('download')
        // The conditional rebuild fetches the checkout, prices it against the
        // remote branch, and rebuilds only when it is behind (or a fresh
        // clone). The decision, the build command, and its output are captured
        // into buildLogs and threaded to the card's Logs section.
        const sync = await syncAndRebuildEngine(
          this.host,
          {
            engineId: this.id,
            directory: engineDir,
            ...(platform?.engineFork !== undefined ? { fork: platform.engineFork } : {}),
            ...(plan.argv?.[0] !== undefined ? { binary: plan.argv[0] } : {}),
            ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
          },
          () => {},
        )
        buildLogs = sync.logs
        if (!sync.ok) {
          return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs }
        }
        // The build step reads as "Building..." only when a build actually
        // ran (a fresh clone, or a rebase of a checkout that was behind).
        if (sync.rebuilt) {
          onProgress?.('build')
        }
      }
      const withLogs = (result: DeployResult): DeployResult =>
        buildLogs !== '' ? { ...result, logs: buildLogs } : result
      onProgress?.('download')
      const download = await this.downloadModel(plan)
      if (!download.ok) return withLogs(download)
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
      trackChild(this.children, this.planKey(plan), handle)
      return withLogs({ ok: true, handle })
    }
    if (plan.kind === 'docker') {
      // The image pull is the docker build step: the card's button reads
      // "Building..." for it.
      onProgress?.('build')
      const pull = await this.host.run(`docker pull ${LLAMACPP_DOCKER_IMAGE}`)
      if (!pull.ok) {
        return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
      }
      const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
      trackChild(this.children, this.planKey(plan), handle)
      return { ok: true, handle }
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
    const customArgs = customArgFlags(config)
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
        ...customArgs,
      ],
      env: {},
      containerName,
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(
    plan: LaunchPlan,
    _platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    _options?: DeployOptions,
  ): Promise<DeployResult> {
    // The image pull is the docker build step: the card's button reads
    // "Building..." for it.
    onProgress?.('build')
    const pull = await this.host.run(`docker pull ${STRATA_DOCKER_IMAGE}`)
    if (!pull.ok) {
      return { ok: false, detail: `docker pull failed: ${pull.detail ?? 'unknown'}` }
    }
    const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {})
    trackChild(this.children, this.planKey(plan), handle)
    return { ok: true, handle }
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

/**
 * InfernixAdapter is the local-only engine for Infernix, the C++/CUDA fork
 * of NInfer (https://github.com/wallawalla47/infernix) tuned for Qwen models
 * on a single RTX 50-series GPU. `renderLaunch` renders a local
 * `infernix-serve` process from the `INFERNIX_PARAMETERS` surface (the
 * Infernix-only fields, from `--ngram-volume` to the quality routes, spell
 * onto the argv only for this engine); `deploy` builds the engine in the
 * engine directory (the engine's own cmake preset), downloads the model
 * artifact (and the n-gram volume, for the multi-file Flash-Next repo) into
 * the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process. The engine ships no docker image,
 * so the adapter supports the local build mode only.
 */
export class InfernixAdapter extends EngineAdapter {
  readonly id = 'infernix'
  readonly supports = { docker: false, local: true }
  private readonly host: LifecycleHost
  private readonly children = new Map<string, ProcessHandle>()

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return INFERNIX_PARAMETERS
  }

  override modelRef(config: Config): { id: string; name: string } {
    // The engine serves the model under the artifact's advertised id, so the
    // registrar publishes that alias and a chat turn routes to it. A model
    // key that names a local artifact file (a directory-scanned model)
    // reuses the 27B alias, the same fallback the NInfer adapter applies.
    const artifact = infernixArtifactFor(infernixModelKey(config))
    return { id: artifact.modelId, name: artifact.modelId }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The local plan runs the infernix-serve binary (the .exe on Windows),
    // so the binary name is the command-line marker the reserve probe
    // matches on, and the port the plan binds rides along.
    return { binary: 'infernix-serve', port: this.port(config) }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const modelKey = infernixModelKey(config)
    const artifact = infernixArtifactFor(modelKey)
    // A model key that names a local artifact file (a directory-scanned
    // model, a .ninfer or .infernix name) overrides the artifact map's file,
    // so a file the user has on disk launches as-is.
    const file =
      modelKey.endsWith('.ninfer') || modelKey.endsWith('.infernix')
        ? modelKey
        : artifact.file
    const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : ''
    const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
    // The engine binary is the .exe on a Windows host, where the published
    // release zip ships the server and its DLLs.
    const binary = process.platform === 'win32' ? 'infernix-serve.exe' : 'infernix-serve'
    const flags = flagsFromSpecs(INFERNIX_PARAMETERS, config)
    // The dflash2 backend always loads a drafter through --draft-model, so the
    // flag is spelled here from the resolved path (the selected DFlash2 preset,
    // or the Custom Draft model field) rather than by a spec toArgv. A config
    // that names no drafter path is the misconfiguration the dflash2
    // guideline names, so the flag is spelled only when a path resolves.
    if (config.spec === 'dflash2') {
      const draftPath = infernixDraftModelPath(config)
      if (draftPath !== null) {
        flags.push('--draft-model', draftPath)
      }
    }
    const customArgs = customArgFlags(config)
    return {
      engineId: this.id,
      kind: 'process',
      argv: [
        binary,
        modelPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--model-id',
        artifact.modelId,
        ...flags,
        ...customArgs,
      ],
      env: {},
      modelId: modelKey,
      ...(modelDirectory === '' ? {} : { modelDirectory }),
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    options?: DeployOptions,
  ): Promise<DeployResult> {
    if (plan.kind !== 'process') {
      // Infernix renders process plans only; a docker or compose plan is a
      // no-op.
      return { ok: true }
    }
    const engineDir = platform?.engineDirectory
    let buildLogs = ''
    // Auto Rebuild off (the card's checkbox): the git sync (fetch, rebase,
    // rebuild) is skipped and the checkout launches as-is.
    if (engineDir !== undefined && options?.autoRebuild !== false) {
      // The git sync is the checkout download: the card's button reads
      // "Downloading..." for it, not "Building...".
      onProgress?.('download')
      // The conditional rebuild fetches the checkout, prices it against the
      // remote branch, and rebuilds only when it is behind (or a fresh
      // clone). The engine's own quick start (the cmake preset, then the
      // preset's build) rides the acquisition-data build steps. The decision,
      // the build command, and its output are captured into buildLogs and
      // threaded to the card's Logs section.
      const sync = await syncAndRebuildEngine(
        this.host,
        {
          engineId: this.id,
          directory: engineDir,
          ...(platform?.engineFork !== undefined ? { fork: platform.engineFork } : {}),
          ...(plan.argv?.[0] !== undefined ? { binary: plan.argv[0] } : {}),
          ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
        },
        () => {},
      )
      buildLogs = sync.logs
      if (!sync.ok) {
        return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs }
      }
      // The build step reads as "Building..." only when a build actually
      // ran (a fresh clone, or a rebase of a checkout that was behind).
      if (sync.rebuilt) {
        onProgress?.('build')
      }
    }
    const withLogs = (result: DeployResult): DeployResult =>
      buildLogs !== '' ? { ...result, logs: buildLogs } : result
    onProgress?.('download')
    const download = await this.downloadModel(plan)
    if (!download.ok) return withLogs(download)
    const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
    this.children.set(this.planKey(plan), handle)
    return withLogs({ ok: true, handle })
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
    }
  }

  private port(config: Config): number {
    // 8080 is the infernix-serve CLI default, so the form seeds it and the
    // adapter falls back to it when a config names no port.
    return typeof config.port === 'number' ? config.port : 8080
  }

  private planKey(plan: LaunchPlan): string {
    return `${plan.engineId}:${plan.port}`
  }

  private async downloadModel(plan: LaunchPlan): Promise<DeployResult> {
    const artifact =
      plan.modelId !== undefined ? INFERNIX_MODEL_ARTIFACTS[plan.modelId] : undefined
    // A model key that names a local artifact file carries no artifact entry,
    // so the file the user has on disk launches as-is without a download.
    if (artifact === undefined) return { ok: true }
    const target = plan.modelDirectory ?? '.'
    // A multi-file artifact (the Flash-Next shards) downloads the whole repo,
    // which carries the n-gram volume beside the shards, so the
    // --ngram-volume flag points at a file the same download left on disk.
    // A single-file artifact downloads the file alone.
    const repo = artifact.repo
    const files = artifact.files ?? []
    const download =
      files.length > 1
        ? await this.host.run(`hf download ${repo} --local-dir ${target}`)
        : await this.host.run(`hf download ${repo} ${artifact.file} --local-dir ${target}`)
    if (!download.ok) {
      return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }
}
