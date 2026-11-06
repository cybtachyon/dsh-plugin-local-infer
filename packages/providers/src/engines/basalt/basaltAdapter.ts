/**
 * The Basalt engine adapter. BasaltAdapter is the Basalt engine (the C++/CUDA
 * serve/ server for the Qwen3.8-Flash-Next MoE model, Blackwell-only).
 * `renderLaunch` renders a `basalt serve --config --engine-bin` process
 * plan: the binary name comes from the host OS profile, every setting and
 * the served model land in the `basalt_config.json` the plan's `configFile`
 * carries (the spec surface rendered with `configFileFromSpecs` into the
 * versioned v2 envelope the 0.3.0 serve CLI accepts), and the argv carries
 * the CLI-only `--engine-bin` flag, so it stays fixed no matter how many
 * settings the form offers. `deploy` builds the engine in the checkout (the
 * acquisition build steps), downloads the `.basalt` model into the model
 * directory, stamps the artifact path into the config entry, writes the
 * config file, and spawns the serve command.
 * `healthCheck` polls the health URL and reports the start phase from the
 * tracked process output. `stop` signals the tracked process.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltAdapter
 */

import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  EngineAdapter,
  hfDownloadCommand,
  hubCacheSnapshotFilePath,
  modelArtifactPath,
  modelDownloadTarget,
  repoIdFromUrl,
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
import { defaultModelFor } from '../../model-defaults.ts'
import {
  BASALT_CONFIG_VERSION,
  BASALT_DEFAULT_MODEL_ID,
  BASALT_DEFAULT_PORT,
  BASALT_MODEL_FILE,
  BASALT_MODEL_REPO,
  BASALT_PARAMETERS,
  BASALT_SERVED_MODEL_ID,
  basaltModelKey,
} from './basalt.ts'
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

// The repo and file the deploy step downloads live in the leaf basalt.ts
// module (the default model list imports them from there, so defining them
// here would close a circular edge). Re-exported so the existing
// `basaltAdapter` import path keeps working.
export { BASALT_MODEL_FILE, BASALT_MODEL_REPO } from './basalt.ts'

/**
 * The config file name the deploy step writes into the model directory, so
 * the engine's `--config` flag and the model artifact share one home.
 */
export const BASALT_CONFIG_FILE = 'basalt_config.json'

/**
 * BasaltConfigBlocks is the parsed block map `configFileFromSpecs` renders
 * from `BASALT_PARAMETERS`: the `server`, `models[]`, and `engine` blocks
 * `renderLaunch` wraps into the versioned v2 envelope. Every block's specs
 * declare defaults, so all three always render; the optionals keep the
 * envelope build total against a future surface edit.
 */
type BasaltConfigBlocks = {
  server?: Record<string, unknown>
  models?: Record<string, unknown>[]
  engine?: Record<string, unknown>
}

/**
 * basaltModelFileName resolves the `.basalt` artifact file name a config's
 * model field names: a value that is already a `.basalt` file name (a
 * directory-scan selection) passes through; a registry key (a default-model
 * selection, e.g. `qwen38-flash-next`) maps to its artifact file through the
 * default model list; and a bare config falls back to the engine's default
 * artifact. The deploy step resolves the file name to the concrete artifact
 * path after the model download.
 */
function basaltModelFileName(modelValue: string): string {
  if (modelValue !== '' && modelValue.endsWith('.basalt')) return modelValue
  const entry = modelValue === '' ? undefined : defaultModelFor('basalt', modelValue)
  return entry?.file ?? BASALT_MODEL_FILE
}

/**
 * configContentWithModelPath returns config file content with the v2
 * envelope's single models entry stamped with the concrete artifact path,
 * replacing the renderLaunch placeholder. Content that is not a JSON object
 * carrying a models array with at least one object entry (a hand-built plan,
 * a plan carrying an unrelated payload) returns as-is: deploy still writes
 * what the plan carries and never crashes.
 */
function configContentWithModelPath(content: string, modelPath: string): string {
  let envelope: unknown
  try {
    envelope = JSON.parse(content)
  } catch {
    return content
  }
  const models =
    envelope !== null && typeof envelope === 'object'
      ? (envelope as { models?: unknown }).models
      : undefined
  if (
    !Array.isArray(models) ||
    models.length === 0 ||
    models[0] === null ||
    typeof models[0] !== 'object'
  ) {
    return content
  }
  models[0] = { ...(models[0] as Record<string, unknown>), model: modelPath }
  return JSON.stringify(envelope, null, 2)
}

/**
 * BasaltAdapter is the Basalt engine. `renderLaunch` renders a
 * `basalt serve --config --engine-bin` process plan (the settings and the
 * served model ride the versioned config file; the argv carries the CLI-only
 * `--engine-bin` flag); `deploy` builds the engine, downloads the model,
 * stamps the artifact path into the config entry, writes the config file,
 * and spawns the serve command; `healthCheck` polls the health URL and
 * reports the start phase from the tracked process output; `stop` signals
 * the tracked process.
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
    // The serve server accepts a request only when its model names the
    // artifact's `meta.name` or the artifact's own file name, and `/v1/models`
    // advertises only the `meta.name`. The config's model value resolves to
    // the artifact file the launch serves (basaltModelFileName: registry key,
    // .basalt path, or the engine default), so a bare config, the registry
    // key, and the bundled file name all publish the served `meta.name`, and
    // any other `.basalt` pick publishes its file name, which the engine also
    // accepts. The registrar writes this id, so the chat turn routes to a
    // name the engine lists.
    const file = basename(basaltModelFileName(basaltModelKey(config)))
    if (file === BASALT_MODEL_FILE) {
      return { id: BASALT_SERVED_MODEL_ID, name: BASALT_SERVED_MODEL_ID }
    }
    return { id: file, name: file }
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
    // command-line marker the reserve probe matches on. The serve CLI binds
    // the port from the basalt_config.json server block, so the argv never
    // carries the number; the port stays the model-tie key for the
    // launched-models map.
    const port = this.port(config)
    return { binary: 'basalt', port, portInArgv: false }
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
    // The .basalt artifact the engine serves, resolved from config.model (a
    // registry key, a .basalt file name, or the engine default). It stamps
    // both the config entry's `model` placeholder and the plan's modelFile
    // field, so the deploy step downloads exactly the file the entry names
    // without re-parsing the rendered config. The entry value is a
    // placeholder the deploy step resolves to the concrete artifact path
    // after the model download (the flat join for a user model directory,
    // the hub-cache snapshot path for the default layout). Upstream refuses
    // a model entry without a `model`, so the stamp below never leaves the
    // entry empty.
    const modelValue = typeof config.model === 'string' ? config.model : ''
    const modelFile = basaltModelFileName(modelValue)
    const modelPath = join(baseDir, modelFile)
    // The config file is the v2 envelope the 0.3.0 serve CLI accepts: the
    // version stamp plus the three blocks the surface renders, in the key
    // order upstream documents. The surface's raw `model` value is a registry
    // key or file name, never the download-target path the engine resolves
    // against the config file's home, so the entry is restamped with the
    // placeholder path before the envelope is sealed.
    const blocks = JSON.parse(
      configFileFromSpecs(BASALT_PARAMETERS, config, 'json'),
    ) as BasaltConfigBlocks
    const configContent = JSON.stringify(
      {
        version: BASALT_CONFIG_VERSION,
        models: [{ ...blocks.models?.[0], model: modelPath }],
        engine: blocks.engine ?? {},
        server: blocks.server ?? {},
      },
      null,
      2,
    )
    return {
      engineId: this.id,
      kind: 'process',
      // The serve CLI takes every setting and the model from the config
      // file, so the argv stays fixed. --engine-bin is CLI-only (refused in
      // the config file): it pins the build-tree binary the first token
      // already names.
      argv: [binaryPath, 'serve', '--config', configPath, '--engine-bin', binaryPath],
      env: {},
      ...(modelDirectory === '' ? {} : { modelDirectory }),
      // The raw config.model value stamps the plan's modelId (a bare config
      // names the engine's single default model), so the service's
      // launched-models tie compares equal against the provider's stored
      // config.model, the infernix pattern.
      modelId: modelValue !== '' ? modelValue : BASALT_DEFAULT_MODEL_ID,
      modelFile,
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
      os: _hw.os,
      // Every setting and the served model ride the v2 config file the
      // deploy step writes; --engine-bin is the only argv addition.
      configFile: {
        path: configPath,
        content: configContent,
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
    // directory. The file name is the basename of the plan's modelFile
    // (renderLaunch stamps it from config.model), so the download fetches
    // exactly the file the config entry names. A bare config (no model
    // directory) downloads into the hub cache (the hub-cache layout, no
    // --local-dir); a user-overridden model directory keeps the flat
    // --local-dir target. A model the shared Get-steps routine already
    // downloaded is on disk, so the deploy step skips the re-fetch and a
    // launch after a Get does no duplicate download.
    const { baseDir, useHubCache } = modelDownloadTarget(plan.modelDirectory)
    const modelFile = basename(plan.modelFile ?? BASALT_MODEL_FILE)
    const artifact = await this.ensureModelArtifact(modelFile, baseDir, useHubCache, onProgress)
    if (!artifact.ok) {
      return withLogs({ ok: false, detail: artifact.detail })
    }
    // Upstream rejects --model beside --config, so the concrete artifact
    // path lands in the config file's models entry (replacing the
    // renderLaunch placeholder) instead of the argv. Stamping the plan keeps
    // writeConfigFile and the launch record reading the one content the
    // engine will see; a plan with no config file writes nothing, and content
    // that is not a v2 envelope is written as-is.
    if (plan.configFile !== undefined) {
      plan.configFile.content = configContentWithModelPath(plan.configFile.content, artifact.path)
    }
    // Write the config file the plan names, so the engine's --config flag
    // points at a path that exists.
    const configFailure = await this.writeConfigFile(plan)
    if (configFailure !== null) {
      return withLogs({ ok: false, detail: configFailure })
    }
    // A relative launch path (a build-tree binary) is joined against the
    // engine directory the spawn runs in, so the spawn resolves an absolute
    // path. A bare name (the basalt binary, on the path after the rebuild's
    // symlink step) is left as-is.
    const resolvedArgv = resolveLaunchArgv(engineDir, plan.argv ?? [])
    // The plan is the launch record's argv source (launchRecordFromPlan reads
    // it), and the re-link rule substring-matches every record argv token
    // against the live command line, so the record must name the spawn, not
    // the build-tree relative binary.
    plan.argv = resolvedArgv
    const handle = this.host.spawn(resolvedArgv, plan.env ?? {}, engineDir)
    trackChild(this.children, this.planKey(plan), handle)
    return withLogs({ ok: true, handle })
  }

  /**
   * ensureModelArtifact downloads the .basalt model file into the model
   * directory and resolves the concrete path the engine serves. A model the
   * Get-steps routine already downloaded is on disk, so the re-fetch is
   * skipped. With the hub-cache layout the concrete path is the
   * content-addressed snapshot path (only known after the download); with the
   * flat layout it is the flat join. Returns the path, or a detail when the
   * download fails or leaves no snapshot.
   */
  private async ensureModelArtifact(
    modelFile: string,
    baseDir: string,
    useHubCache: boolean,
    onProgress?: LaunchProgress,
  ): Promise<{ ok: true; path: string } | { ok: false; detail: string }> {
    const entry: DefaultModel = {
      engineId: this.id,
      modelId: 'basalt',
      label: 'Basalt',
      url: `https://huggingface.co/${BASALT_MODEL_REPO}`,
      file: modelFile,
    }
    if (!existsSync(modelArtifactPath(entry, baseDir, useHubCache))) {
      onProgress?.('download')
      const download = await this.host.run(hfDownloadCommand(entry, baseDir, useHubCache))
      if (!download.ok) {
        return { ok: false, detail: `model download failed: ${download.detail ?? 'unknown'}` }
      }
    }
    if (useHubCache) {
      // The hf CLI writes the content-addressed snapshots tree, whose commit
      // directory is only known after the download. A download that left no
      // snapshot (a failed or partial fetch the hf CLI reported as ok) leaves
      // no artifact to serve.
      const snapshotPath = hubCacheSnapshotFilePath(baseDir, repoIdFromUrl(entry.url), modelFile)
      if (snapshotPath === null) {
        return {
          ok: false,
          detail: `model artifact missing: ${modelFile} (no hub-cache snapshot after download)`,
        }
      }
      return { ok: true, path: snapshotPath }
    }
    return { ok: true, path: join(baseDir, modelFile) }
  }

  /**
   * writeConfigFile writes the config file the plan names, so the engine's
   * --config flag points at a path that exists. The config path is always
   * absolute (renderLaunch joins the model download target base directory),
   * so the file lands in the model download target directory, never the
   * engine's git checkout. Returns a failure detail (a host that cannot write
   * files, a test stub) or null when the write succeeded or the plan names no
   * config file.
   */
  private async writeConfigFile(plan: LaunchPlan): Promise<string | null> {
    if (plan.configFile === undefined) return null
    if (this.host.writeFile === undefined) {
      return 'the host cannot write the config file'
    }
    await this.host.writeFile(plan.configFile.path, plan.configFile.content)
    return null
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    // The health poll is the shared loop (a 200 is ready, the attempt cap
    // times out). Basalt downloads its model in the deploy step, so the
    // engine's own start has no download phase: a tracked process that is
    // still coming up reads as starting, and a missing handle (no deploy
    // tracked one) reads as failed. The tracked handle rides into the poll,
    // so a child that exits (a crash) ends the poll early with the failed
    // state the poll stamps.
    const handle = this.children.get(this.planKey(plan))
    const result = await pollHealth(this.host, plan, options, handle)
    if (result.healthy) {
      return { ...result, state: 'ready' }
    }
    if (result.state === 'failed') {
      // The poll ended early because the tracked child exited: the process
      // is gone, so the start reads as failed, not starting.
      return result
    }
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
    // The port the basalt serve CLI binds by default, so a bare config
    // launches on it.
    return typeof config.port === 'number' ? config.port : BASALT_DEFAULT_PORT
  }
}
