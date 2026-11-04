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

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  EngineAdapter,
  hfDownloadCommand,
  modelArtifactPath,
  modelDownloadTarget,
} from '../../../../core/lib/index.js'
import type {
  Config,
  DefaultModel,
  DeployOptions,
  DeployResult,
  EngineLaunchSignature,
  EngineLaunchState,
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
  configFileFromSpecs,
  nodeLifecycleHost,
  pollHealth,
  resolveLaunchArgv,
  stopProcessPlan,
  trackChild,
} from '../../adapters.ts'
import { engineBuildDir, syncEngineForDeploy } from '../../acquire.ts'
import { BASALT_PARAMETERS, basaltModelKey } from './basalt.ts'
import { basaltLinuxBinary } from './basaltLinux.ts'
import { basaltMacOSBinary } from './basaltMacOS.ts'
import { basaltWindowsBinary } from './basaltWindows.ts'

/**
 * The Basalt engine binary is OS-specific (the .exe on Windows, where the
 * Ninja/MSVC route writes the Release binary), so the launch binary comes
 * from the host OS's binary function. The adapter's renderLaunch reads this
 * map by the hardware profile's os, keeping the per-OS name in its own OS
 * file.
 */
const BASALT_BINARY: Record<'linux' | 'windows' | 'macos', () => string> = {
  linux: basaltLinuxBinary,
  macos: basaltMacOSBinary,
  windows: basaltWindowsBinary,
}

/**
 * The Hugging Face repo and file the deploy step downloads into the model
 * directory: the single `.basalt` artifact the engine serves (the weights,
 * tokenizer, chat template, drafter, vision projector, and default
 * sampling all come from it).
 */
export const BASALT_MODEL_REPO = 'jesdga/Qwen3.8-Flash-Next-Basalt'
export const BASALT_MODEL_FILE = 'Qwen3.8-FN-NVFP4-DQ6_K.basalt'

/**
 * The config file name the deploy step writes into the model directory, so
 * the engine's `--config` flag and the model artifact share one home.
 */
export const BASALT_CONFIG_FILE = 'basalt_config.json'

/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config` process plan (the settings ride the config file,
 * never the argv); `deploy` builds the engine, downloads the model, writes
 * the config file, and spawns the serve command; `healthCheck` polls the
 * health URL and reports the start phase from the tracked process output;
 * `stop` signals the tracked process.
 */
export class BasaltAdapter extends EngineAdapter {
  readonly id = 'basalt'
  readonly supports = { docker: false, local: true }
  private readonly host: LifecycleHost
  private readonly children = new Map<string, ProcessHandle>()

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return BASALT_PARAMETERS
  }

  override modelRef(config: Config): { id: string; name: string } {
    // The engine serves the model file the config names (a .basalt path), so
    // the registrar publishes that path and a chat turn routes to it. A bare
    // config (the deploy step downloads the default artifact) reads as the
    // engine name.
    const model = basaltModelKey(config)
    return model !== '' ? { id: model, name: model } : { id: 'basalt', name: 'Basalt' }
  }

  override modelInput(config: Config): string[] {
    // The vision control gates the image input. off (the default) reads no
    // pictures; every other value (dynamic, cpu, a pinned GPU number spelled
    // as a string or a number) does.
    const vision = config.vision
    if (typeof vision === 'number') {
      return ['text', 'image']
    }
    if (typeof vision === 'string' && vision !== '' && vision !== 'off') {
      return ['text', 'image']
    }
    return ['text']
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The local plan runs the basalt binary, so the binary name is the
    // command-line marker the reserve probe matches on.
    const port = this.port(config)
    return { binary: 'basalt', port }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const modelDirectory = typeof config.modelDirectory === 'string' ? config.modelDirectory : ''
    // The config file lands in the model download target directory (the
    // hub-cache root for the default layout, the user model directory for an
    // override), so the engine's --config flag and the model artifact share one
    // home and the config never dirties the engine's git checkout.
    const { baseDir } = modelDownloadTarget(modelDirectory)
    const configPath = join(baseDir, BASALT_CONFIG_FILE)
    // The engine binary is OS-specific (the .exe on Windows), so the name
    // comes from the host OS's binary function. CMake writes it into the
    // profile's buildDir (the repo's bin/ folder), so the launch spells it as
    // a build-tree relative path. The deploy step joins it against the engine
    // directory, so the spawn resolves the real binary without relying on the
    // PATH (a bare name would ENOENT when the rebuild's symlink step has not
    // put it on the path).
    const binary = BASALT_BINARY[_hw.os]()
    const buildDir = engineBuildDir(this.id, _hw.os)
    const binaryPath = buildDir === '' ? binary : join(buildDir, binary)
    return {
      engineId: this.id,
      kind: 'process',
      argv: [binaryPath, 'serve', '--config', configPath],
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
    }
  }

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    options?: DeployOptions,
  ): Promise<DeployResult> {
    if (plan.kind !== 'process') {
      // Basalt renders process plans only; a docker or compose plan is a
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
      // clone). The decision, the build command, and its output are captured
      // into buildLogs and threaded to the card's Logs section.
      const sync = await syncEngineForDeploy(this.host, {
        engineId: this.id,
        directory: engineDir,
        ...(platform !== undefined ? { platform } : {}),
        ...(options !== undefined ? { options } : {}),
        // The host OS the build steps pick for: a Windows host reads the
        // engine's Windows build steps (the Ninja/MSVC route) when the user
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
    // The .basalt model artifact the engine serves, downloaded into the model
    // directory. A bare config (no model directory) downloads into the hub
    // cache (the hub-cache layout, no --local-dir); a user-overridden model
    // directory keeps the flat --local-dir target. A model the shared
    // Get-steps routine already downloaded is on disk, so the deploy step
    // skips the re-fetch and a launch after a Get does no duplicate download.
    const { baseDir, useHubCache } = modelDownloadTarget(plan.modelDirectory)
    const entry: DefaultModel = {
      engineId: this.id,
      modelId: 'basalt',
      label: 'Basalt',
      url: `https://huggingface.co/${BASALT_MODEL_REPO}`,
      file: BASALT_MODEL_FILE,
    }
    if (!existsSync(modelArtifactPath(entry, baseDir, useHubCache))) {
      onProgress?.('download')
      const download = await this.host.run(hfDownloadCommand(entry, baseDir, useHubCache))
      if (!download.ok) {
        return withLogs({
          ok: false,
          detail: `model download failed: ${download.detail ?? 'unknown'}`,
        })
      }
    }
    // Write the config file the plan names, so the engine's --config flag
    // points at a path that exists. A host that cannot write files (a test
    // stub) fails the launch rather than spawn an engine that reads no
    // config.
    if (plan.configFile !== undefined) {
      if (this.host.writeFile === undefined) {
        return withLogs({ ok: false, detail: 'the host cannot write the config file' })
      }
      // The config path is always absolute (renderLaunch joins the model
      // download target base directory), so the file is written as-is into the
      // model download target directory, never the engine's git checkout.
      await this.host.writeFile(plan.configFile.path, plan.configFile.content)
    }
    // A relative launch path (a build-tree binary) is joined against the
    // engine directory the spawn runs in, so the spawn resolves an absolute
    // path. A bare name (the basalt binary, on the path after the rebuild's
    // symlink step) is left as-is.
    const resolvedArgv = resolveLaunchArgv(engineDir, plan.argv)
    const handle = this.host.spawn(resolvedArgv, plan.env ?? {}, engineDir)
    trackChild(this.children, this.planKey(plan), handle)
    return withLogs({ ok: true, handle })
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    // The health poll is the shared loop (a 200 is ready, the attempt cap
    // times out). Basalt downloads its model in the deploy step, so the
    // engine's own start has no download phase: a tracked process that is
    // still coming up reads as starting, and a missing handle (no deploy
    // tracked one, or the process already ended) reads as failed.
    const result = await pollHealth(this.host, plan, options)
    if (result.healthy) {
      return { ...result, state: 'ready' }
    }
    const handle = this.children.get(this.planKey(plan))
    const state: EngineLaunchState =
      handle !== undefined && (handle.logs ?? '') !== '' ? 'starting' : 'failed'
    return { ...result, state }
  }

  async stop(plan: LaunchPlan): Promise<void> {
    // The serve process is the tracked child: signal it and drop the entry,
    // so a later stop never signals a pid a recycled process has taken over.
    const handle = this.children.get(this.planKey(plan))
    if (handle !== undefined) {
      handle.kill()
      this.children.delete(this.planKey(plan))
      return
    }
    // No tracked child (an engine a DSH restart re-adopted): signal the pid
    // the stored launch record stamped on the plan, so the stop reaches a
    // process this adapter instance did not spawn.
    await stopProcessPlan(this.host, plan)
  }

  private port(config: Config): number {
    // 8080 is the port the basalt serve CLI binds by default, so a bare
    // config launches on it.
    return typeof config.port === 'number' ? config.port : 8080
  }
}
