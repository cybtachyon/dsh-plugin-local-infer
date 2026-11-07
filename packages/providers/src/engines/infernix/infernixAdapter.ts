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
 * @module dsh-plugin-local-infer/providers/engines/infernix/infernixAdapter
 */

import { join } from 'node:path'
import {
  EngineAdapter,
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
  stopProcessPlan,
} from '../../adapters.ts'
import { syncEngineForDeploy } from '../../acquire.ts'
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
    // The hub-cache layout (the model directory is the plugin default)
    // resolves the concrete snapshot file the engine reads; a user override
    // keeps the flat model-directory path. A not-yet-downloaded model falls
    // back to the bare file name, the same as the flat layout's missing-file
    // case.
    const modelPath =
      modelDirectory === ''
        ? (hubCacheSnapshotFilePath(hfHubCacheDirectory(), artifact.repo, file) ?? file)
        : join(modelDirectory, file)
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
      // The conditional rebuild fetches the checkout, prices it against the
      // remote branch, and rebuilds only when it is behind (or a fresh
      // clone). The engine's own quick start (the cmake preset, then the
      // preset's build) rides the acquisition-data build steps. The decision,
      // the build command, and its output are captured into buildLogs and
      // threaded to the card's Logs section.
      const sync = await syncEngineForDeploy(this.host, {
        engineId: this.id,
        directory: engineDir,
        ...(platform !== undefined ? { platform } : {}),
        ...(options !== undefined ? { options } : {}),
        // The host OS the build steps pick for: a Windows host reads the
        // engine's Windows build steps when the user carries no build-
        // command override.
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
    const handle = this.host.spawn(plan.argv ?? [], plan.env ?? {}, engineDir)
    this.children.set(this.planKey(plan), handle)
    return withLogs({ ok: true, handle })
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    // The tracked handle rides into the poll, so a child that exits (a
    // crash) ends the poll early with a failed result.
    return pollHealth(this.host, plan, options, this.children.get(this.planKey(plan)))
  }

  async stop(plan: LaunchPlan, log?: CommandLogger): Promise<void> {
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

  private port(config: Config): number {
    // 8080 is the infernix-serve CLI default, so the form seeds it and the
    // adapter falls back to it when a config names no port.
    return typeof config.port === 'number' ? config.port : 8080
  }

  private async downloadModel(plan: LaunchPlan, log?: CommandLogger): Promise<DeployResult> {
    const artifact =
      plan.modelId !== undefined ? INFERNIX_MODEL_ARTIFACTS[plan.modelId] : undefined
    // A model key that names a local artifact file carries no artifact entry,
    // so the file the user has on disk launches as-is without a download.
    if (artifact === undefined) return { ok: true }
    // The hub-cache layout (no --local-dir) applies when the model directory is
    // the plugin default; a user override keeps the flat --local-dir target.
    const { baseDir, useHubCache } = modelDownloadTarget(plan.modelDirectory)
    // A multi-file artifact (the Flash-Next shards) downloads the whole repo,
    // which carries the n-gram volume beside the shards, so the
    // --ngram-volume flag points at a file the same download left on disk.
    // A single-file artifact downloads the file alone.
    const repo = artifact.repo
    const files = artifact.files ?? [artifact.file]
    const entry: DefaultModel = {
      engineId: this.id,
      modelId: plan.modelId ?? '',
      label: artifact.modelId,
      url: `https://huggingface.co/${repo}`,
      ...(files.length > 1 ? {} : { file: artifact.file }),
    }
    // A model the shared Get-steps routine already downloaded is on disk, so
    // the deploy step skips the re-fetch and a launch after a Get does no
    // duplicate download. Presence is the snapshot the hub-cache layout
    // resolves or the flat artifact path (modelArtifactPresent), never a
    // bare blobs folder: a cache whose snapshot links are missing (the
    // interrupted first download) re-runs the cheap hf download, which
    // reuses the blobs and writes the links.
    if (modelArtifactPresent(entry, baseDir, useHubCache)) return { ok: true }
    const download = await auditRun(this.host, hfDownloadCommand(entry, baseDir, useHubCache), log)
    if (!download.ok) {
      return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }
}
