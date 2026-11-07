/**
 * The NInfer engine adapter. NInferModelArtifact is the per-model deploy data:
 * the `.ninfer` artifact file, the Hugging Face repo the model download pulls
 * it from, and the `--model-id` alias the server advertises. The data is the
 * surface; adding a model is a data edit here, never an adapter rewire.
 * NInferAdapter is the canonical both-capable engine. `renderLaunch` renders a
 * local `ninfer-serve` process or a `docker run` of the ghcr image from the
 * same spec surface; `deploy` builds the engine in the engine directory (or
 * pulls the image), downloads the model into the model directory, and starts
 * the engine; `healthCheck` polls the health URL; `stop` signals the tracked
 * process and stops the named container.
 * @module dsh-plugin-local-infer/providers/engines/ninfer/ninferAdapter
 */

import { basename, dirname, join } from 'node:path'
import {
  CHAT_TEMPLATE_FILE,
  EngineAdapter,
  chatTemplateArtifactPath,
  chatTemplatePresent,
  hfChatTemplateCommand,
  hfDownloadCommand,
  hfHubCacheDirectory,
  hubCacheSnapshotFilePath,
  modelArtifactPresent,
  modelDownloadTarget,
} from '../../../../core/lib/index.js'
import type {
  CommandLogger,
  Config,
  DefaultModel,
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
} from '../../../../core/lib/index.js'
import {
  auditRun,
  customArgFlags,
  flagsFromSpecs,
  nodeLifecycleHost,
  pollHealth,
  resolveLaunchArgv,
  stopProcessPlan,
  trackChild,
} from '../../adapters.ts'
import { syncEngineForDeploy } from '../../acquire.ts'
import { NINFER_PARAMETERS } from './ninfer.ts'
import { ninferLinuxBinary } from './ninferLinux.ts'
import { ninferMacOSBinary } from './ninferMacOS.ts'
import { ninferWindowsBinary } from './ninferWindows.ts'

/**
 * The NInfer engine binary is OS-specific (the .exe on Windows, where the
 * vcpkg build-native route writes the Release binary), so the launch binary
 * comes from the host OS's binary function. The adapter's renderLaunch reads
 * this map by the hardware profile's os, keeping the per-OS name in its own OS
 * file.
 */
const NINFER_BINARY: Record<'linux' | 'windows' | 'macos', () => string> = {
  linux: ninferLinuxBinary,
  macos: ninferMacOSBinary,
  windows: ninferWindowsBinary,
}

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
        os: _hw.os,
      }
    }
    // The hub-cache layout (the model directory is the plugin default)
    // resolves the concrete snapshot file the engine reads; a user override
    // keeps the flat model-directory path. A not-yet-downloaded model falls
    // back to the bare file name, the same as the flat layout's missing-file
    // case.
    const modelPath =
      modelDirectory === ''
        ? (hubCacheSnapshotFilePath(hfHubCacheDirectory(), artifact.repo, file) ?? file)
        : join(modelDirectory, file)
    const customArgs = customArgFlags(config)
    return {
      engineId: this.id,
      kind: 'process',
      argv: [
        // The engine binary is OS-specific (the .exe on Windows), so the name
        // comes from the host OS's binary function.
        NINFER_BINARY[_hw.os](),
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
        // The conditional rebuild fetches the checkout, prices it against the
        // remote branch, and rebuilds only when it is behind (or a fresh
        // clone). The decision, the build command, and its output are captured
        // into buildLogs and threaded to the card's Logs section.
        const sync = await syncEngineForDeploy(this.host, {
          engineId: this.id,
          directory: engineDir,
          ...(platform !== undefined ? { platform } : {}),
          ...(options !== undefined ? { options } : {}),
          // The host OS the build steps pick for: a Windows host reads the
          // engine's Windows build steps (the vcpkg route) when the user
          // carries no build-command override.
          ...(plan.os !== undefined ? { os: plan.os } : {}),
          ...(onProgress !== undefined ? { onProgress } : {}),
        })
        buildLogs = sync.buildLogs
        if (!sync.ok) {
          return { ok: false, detail: sync.detail ?? 'unknown', logs: buildLogs }
        }
      }
      const withLogs = (result: DeployResult): DeployResult =>
        buildLogs !== '' ? { ...result, logs: buildLogs } : result
      onProgress?.('download')
      const download = await this.downloadModel(plan, options?.onLog)
      if (!download.ok) return withLogs(download)
      // A chat template the user picked as an HF repo reference (the combo
      // control's known choices) is not a path the engine can read, so the
      // deploy step downloads it into the model directory and rewrites the
      // --chat-template flag to the local file before the spawn.
      onProgress?.('download')
      const templateResult = await this.resolveChatTemplate(plan, options?.onLog)
      if (!templateResult.ok) return withLogs(templateResult)
      // A relative launch path (the NInfer Windows build tree,
      // build-windows\apps\Release\ninfer-serve.exe) is joined against the
      // engine directory the spawn runs in, so the spawn resolves an absolute
      // path. A bare name (the Linux and macOS binaries, resolved against the
      // path) is left as-is.
      const resolvedArgv = resolveLaunchArgv(engineDir, plan.argv)
      // The plan is the launch record's argv source (launchRecordFromPlan reads
      // it), and the re-link rule substring-matches every record argv token
      // against the live command line, so the record must name the spawn, not
      // the build-tree relative binary.
      plan.argv = resolvedArgv
      const handle = this.host.spawn(resolvedArgv, plan.env ?? {}, engineDir)
      trackChild(this.children, this.planKey(plan), handle)
      return withLogs({ ok: true, handle })
    }
    if (plan.kind === 'docker') {
      // The image pull is the docker build step: the card's button reads
      // "Building..." for it, and its `$ <command>` line reaches the launch
      // run's log sink before the child spawns.
      onProgress?.('build')
      const pull = await auditRun(this.host, `docker pull ${NINFER_DOCKER_IMAGE}`, options?.onLog)
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
    // The tracked handle rides into the poll, so a child that exits (a
    // crash) ends the poll early with a failed result.
    return pollHealth(this.host, plan, options, this.children.get(this.planKey(plan)))
  }

  async stop(plan: LaunchPlan, log?: CommandLogger): Promise<void> {
    if (plan.kind === 'docker' && plan.containerName !== undefined) {
      await auditRun(this.host, `docker stop ${plan.containerName}`, log)
    }
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
      return
    }
    // No tracked child (an engine a DSH restart re-adopted): signal the pid
    // the stored launch record stamped on the plan, so the stop reaches a
    // process this adapter instance did not spawn.
    await stopProcessPlan(this.host, plan, log)
  }

  private buildMode(config: Config): 'docker' | 'local' {
    return config.buildMode === 'docker' ? 'docker' : 'local'
  }

  private port(config: Config): number {
    // 18020 is the port the ninfer-serve CLI binds by default, so a bare
    // config launches on it.
    return typeof config.port === 'number' ? config.port : 18020
  }

  private async downloadModel(plan: LaunchPlan, log?: CommandLogger): Promise<DeployResult> {
    const artifact = plan.modelId !== undefined ? NINFER_MODEL_ARTIFACTS[plan.modelId] : undefined
    if (artifact === undefined) return { ok: true }
    // The hub-cache layout (no --local-dir) applies when the model directory is
    // the plugin default; a user override keeps the flat --local-dir target.
    const { baseDir, useHubCache } = modelDownloadTarget(plan.modelDirectory)
    const entry: DefaultModel = {
      engineId: this.id,
      modelId: plan.modelId ?? '',
      label: artifact.modelId,
      url: `https://huggingface.co/${artifact.repo}`,
      file: artifact.file,
    }
    // A model the shared Get-steps routine already downloaded is on disk, so
    // the deploy step skips the re-fetch and a launch after a Get does no
    // duplicate download. Presence is the deterministic snapshot the resolved
    // layout holds (modelArtifactPresent), never a bare blobs folder: a cache
    // whose snapshot links are missing re-runs the cheap hf download, which
    // reuses the blobs and writes the links.
    if (modelArtifactPresent(entry, baseDir, useHubCache)) return { ok: true }
    const download = await auditRun(this.host, hfDownloadCommand(entry, baseDir, useHubCache), log)
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
  private async resolveChatTemplate(plan: LaunchPlan, log?: CommandLogger): Promise<DeployResult> {
    const argv = plan.argv
    if (argv === undefined) return { ok: true }
    const index = argv.indexOf('--chat-template')
    if (index === -1) return { ok: true }
    const value = argv[index + 1]
    if (value === undefined) return { ok: true }
    // An absolute path (a leading /) is already local; a value with no slash
    // is a bare file name the engine resolves against its own directory.
    if (value.startsWith('/') || !value.includes('/')) return { ok: true }
    // An HF repo reference: download the template file and point the flag at
    // the local copy. The hub-cache layout (the model directory is the plugin
    // default) resolves the concrete snapshot file path the hf CLI writes; a
    // user override keeps the flat model-directory path. The flat path is
    // built with join (the host's path module normalizes the separators), so
    // the flag the engine reads resolves on Windows, Linux, and macOS alike.
    const { baseDir, useHubCache } = modelDownloadTarget(plan.modelDirectory)
    // The hub-cache branch resolves the deterministic snapshot file; the flat
    // branch asks the shared presence predicate for the template join.
    const resolvePath = (): string | null =>
      useHubCache
        ? hubCacheSnapshotFilePath(baseDir, value, CHAT_TEMPLATE_FILE)
        : chatTemplatePresent(value, baseDir)
          ? chatTemplateArtifactPath(baseDir)
          : null
    let localPath = resolvePath()
    // A template already on disk skips the re-fetch; the hf CLI is optional,
    // so a download failure is reported but does not abort the launch.
    if (localPath === null) {
      const download = await auditRun(
        this.host,
        hfChatTemplateCommand(value, baseDir, useHubCache),
        log,
      )
      if (!download.ok) {
        return {
          ok: false,
          detail: `chat template download failed: ${download.detail ?? 'unknown'}`,
        }
      }
      localPath = resolvePath()
      if (localPath === null) {
        return { ok: false, detail: 'chat template download failed' }
      }
    }
    argv[index + 1] = localPath
    return { ok: true }
  }
}
