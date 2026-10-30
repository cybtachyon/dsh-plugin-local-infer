/**
 * The Infernix engine adapter. InfernixAdapter is the local-only engine for
 * Infernix, the C++/CUDA fork of NInfer (https://github.com/wallawalla47/infernix)
 * tuned for Qwen models on a single RTX 50-series GPU. `renderLaunch` renders a
 * local `infernix-serve` process from the `INFERNIX_PARAMETERS` surface (the
 * Infernix-only fields, from `--ngram-volume` to the quality routes, spell
 * onto the argv only for this engine); `deploy` builds the engine in the
 * engine directory (the engine's own cmake preset), downloads the model
 * artifact (and the n-gram volume, for the multi-file Flash-Next repo) into
 * the model directory, and starts the engine; `healthCheck` polls the health
 * URL; `stop` signals the tracked process. The engine ships no docker image,
 * so the adapter supports the local build mode only.
 * @module dsh-plugin-local-infer/providers/engines/infernixAdapter
 */

import { join } from 'node:path'
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
} from '../adapters.ts'
import { syncAndRebuildEngine } from '../acquire.ts'
import {
  INFERNIX_MODEL_ARTIFACTS,
  INFERNIX_PARAMETERS,
  infernixArtifactFor,
  infernixDraftModelPath,
  infernixModelKey,
} from './infernix.ts'
import { infernixLinuxBinary } from './infernixLinux.ts'
import { infernixMacOSBinary } from './infernixMacOS.ts'
import { infernixWindowsBinary } from './infernixWindows.ts'

/**
 * The Infernix engine binary is OS-specific (the .exe on Windows, where the
 * published release zip ships the server and its DLLs), so the launch binary
 * comes from the host OS's binary function. The adapter's renderLaunch reads
 * this map by the hardware profile's os, keeping the per-OS name in its own OS
 * file.
 */
const INFERNIX_BINARY: Record<'linux' | 'windows' | 'macos', () => string> = {
  linux: infernixLinuxBinary,
  macos: infernixMacOSBinary,
  windows: infernixWindowsBinary,
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
    // release zip ships the server and its DLLs. The name comes from the host
    // OS's binary function, so the .exe spelling has one home in the OS file.
    const binary = INFERNIX_BINARY[_hw.os]()
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
      os: _hw.os,
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
