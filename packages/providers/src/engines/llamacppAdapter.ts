/**
 * The llama.cpp engine adapter. LlamaCppAdapter is the llama.cpp engine,
 * both-capable like NInfer. `renderLaunch` renders a local `llama-server`
 * process or a `docker run` of the ggml image from the same
 * `LLAMACPP_PARAMETERS` surface; `deploy` builds the engine in the engine
 * directory (or pulls the image), downloads the GGUF model into the model
 * directory, and starts the engine; `healthCheck` polls the health URL;
 * `stop` signals the tracked process and stops the named container.
 * @module dsh-plugin-local-infer/providers/engines/llamacppAdapter
 */

import { basename, dirname, join } from 'node:path'
import { EngineAdapter } from '../../../core/lib/index.js'
import type {
  Config,
  DeployOptions,
  DeployResult,
  EngineLaunchSignature,
  EnginePlatformConfig,
  HealthCheckOptions,
  HealthResult,
  HardwareProfile,
  LaunchPlan,
  LaunchProgress,
  LifecycleHost,
  ParameterSpec,
  ProcessHandle,
} from '../../../core/lib/index.js'
import {
  customArgFlags,
  flagsFromSpecs,
  nodeLifecycleHost,
  pollHealth,
  trackChild,
} from '../adapters.ts'
import { syncAndRebuildEngine } from '../acquire.ts'
import {
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from './llamacpp.ts'
import type { LlamaCppModelArtifact } from './llamacpp.ts'
import { llamacppLinuxBinary } from './llamacppLinux.ts'
import { llamacppMacOSBinary } from './llamacppMacOS.ts'
import { llamacppWindowsBinary } from './llamacppWindows.ts'

/**
 * The llama.cpp engine binary is OS-specific (the .exe on Windows), so the
 * launch binary comes from the host OS's binary function. The adapter's
 * renderLaunch reads this map by the hardware profile's os, keeping the per-OS
 * name in its own OS file.
 */
const LLAMACPP_BINARY: Record<'linux' | 'windows' | 'macos', () => string> = {
  linux: llamacppLinuxBinary,
  macos: llamacppMacOSBinary,
  windows: llamacppWindowsBinary,
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
        os: _hw.os,
      }
    }
    const modelPath = modelDirectory === '' ? file : join(modelDirectory, file)
    const customArgs = customArgFlags(config)
    return {
      engineId: this.id,
      kind: 'process',
      argv: [
        // The engine binary is OS-specific (the .exe on Windows), so the name
        // comes from the host OS's binary function.
        LLAMACPP_BINARY[_hw.os](),
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
      os: _hw.os,
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
            ...(options?.allowRunDeps !== undefined ? { allowRunDeps: options.allowRunDeps } : {}),
            ...(platform?.buildCommands !== undefined
              ? { buildCommands: platform.buildCommands }
              : {}),
            // The host OS the build steps pick for: a Windows host reads the
            // engine's Windows build steps when the user carries no build-
            // command override.
            ...(plan.os !== undefined ? { os: plan.os } : {}),
            // Report the build phase the moment the build steps start, so the
            // card's button reads "Building..." while the build is in flight.
            onBuildStart: () => onProgress?.('build'),
          },
          () => {},
        )
        buildLogs = sync.logs
        if (!sync.ok) {
          return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs }
        }
        // The build output reads as a fresh Logs section: a "Building..."
        // separator leads the build decision and output, the same line the
        // card writes when the build step event lands.
        if (sync.rebuilt && buildLogs !== '') {
          buildLogs = `--- Building...\n${buildLogs}`
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
