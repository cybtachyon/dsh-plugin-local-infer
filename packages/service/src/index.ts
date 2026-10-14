/**
 * Service Definition for the local-inference capability seam (`ctx.localInfer`):
 * the engine, preset, guideline, VramModel, and dep-plan registries plus the
 * orchestration entry points that turn a config and a hardware profile into an
 * estimate, a set of warnings, a dependency plan, a launch, and a registered
 * DSH model.
 *
 * Providers register against the registries; the tool package and the UI call
 * the entry points. Registration is order-independent and a duplicate id is a
 * loud conflict, so hot-reload order never changes routing. `estimate` is
 * filled in by Phase 2 over the core estimator, `guidelines` by Phase 3 over
 * the core guideline engine, `deps`, `installString`, and `runInstall` by
 * Phase 4 over the core provisioner, `launch` and `stop` by Phase 5 over the
 * registered engine adapters, `registerModel` and `removeModel` by
 * Phase 6 over the dsh settings seam, and `resolveDefaults` and
 * `fetchPreset` by Phase 7 over the core defaults resolver and the
 * mod-search bridge.
 * @module @dsh/dsh-plugin-local-infer/service
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus, homedir, platform, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  agentDefaultOps,
  agentDefaultPointsAt,
  agentDefaultUnsetOps,
  buildModelEntry,
  detectHardware as detectHardwareFromProbes,
  detectPackageManager,
  evaluateGuidelines,
  estimateVram,
  LLM_PI_AI_NAMESPACE,
  modelGuidelines,
  modelRowsFrom,
  parseNvidiaSmiGpu,
  presetFromFetch,
  providerRegistrationOps,
  providerRemovalOps,
  removeModelRow,
  renderInstallString,
  resolveDefaults as resolveDefaultsFromPresets,
  runInstall,
} from '../../core/lib/index.js'
import type {
  CommandOutcome,
  Config,
  EngineAdapter,
  EngineDepPlan,
  EnginePlatformConfig,
  Guideline,
  GuidelineResult,
  GpuProbe,
  HardwareProfile,
  HardwareProbes,
  InstallResult,
  LaunchPlan,
  ModelRow,
  ParameterSpec,
  Preset,
  PresetSource,
  RegisterResult,
  ResolvedDefaults,
  SystemDep,
  VramModel,
} from '@dsh/dsh-plugin-local-infer/core'
import type {
  EstimateResult,
  FetchPresetOptions,
  FetchPresetResult,
  LaunchOptions,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
  SettingsForms,
  SettingsNamespaceDescriptor,
} from './types.ts'

export type {
  EstimateResult,
  FetchPresetOptions,
  FetchPresetResult,
  LaunchOptions,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
  SettingsForms,
  SettingsNamespaceDescriptor,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    localInfer: LocalInferService
  }
}

/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_INVALID_MODEL`, `LOCAL_INFER_SETTINGS_UNAVAILABLE`) that
 * callers route on instead of parsing the message.
 */
export class LocalInferError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'LocalInferError'
    this.code = code
  }
}

/**
 * The probe timeout. A hung nvidia-smi or docker must not hang the panel, so
 * every probe command is killed after this many milliseconds and read as
 * "not available" instead.
 */
const PROBE_TIMEOUT_MS = 5000

/**
 * `ctx.localInfer`. Holds the engine, preset, guideline, and VramModel
 * reservations; the registries are read per call so a provider that unloads
 * mid-session stops serving without leaving a stale route behind.
 */
export class LocalInfer extends Service implements LocalInferService {
  private readonly engineRegistry = new Map<string, EngineAdapter>()
  private readonly presetRegistry = new Map<string, Preset>()
  private readonly guidelineRegistry = new Map<string, Guideline>()
  private readonly vramModelRegistry = new Map<string, VramModel>()
  private readonly depPlanRegistry = new Map<string, EngineDepPlan>()
  private readonly platformConfigRegistry = new Map<string, EnginePlatformConfig>()

  constructor(ctx: Context) {
    super(ctx, 'localInfer')
  }

  registerEngine(adapter: EngineAdapter): () => void {
    const id = adapter.id
    if (id.trim() === '') {
      throw new LocalInferError('an engine adapter id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE')
    }
    if (this.engineRegistry.has(id)) {
      throw new LocalInferError(`an engine adapter with id "${id}" is already registered`, 'LOCAL_INFER_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: LocalInfer) {
      this.engineRegistry.set(id, adapter)
      yield () => {
        this.engineRegistry.delete(id)
      }
    }.bind(this), 'localInfer.registerEngine()')
    // ctx.effect's disposer returns Promise<void>; the registry disposer is a
    // synchronous fire-and-forget, so discard the (always-resolved) promise.
    return () => void dispose()
  }

  registerPreset(preset: Preset): () => void {
    const key = presetKey(preset)
    if (this.presetRegistry.has(key)) {
      throw new LocalInferError(`a preset for "${key}" is already registered`, 'LOCAL_INFER_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: LocalInfer) {
      this.presetRegistry.set(key, preset)
      yield () => {
        this.presetRegistry.delete(key)
      }
    }.bind(this), 'localInfer.registerPreset()')
    return () => void dispose()
  }

  registerGuideline(guideline: Guideline): () => void {
    if (this.guidelineRegistry.has(guideline.id)) {
      throw new LocalInferError(`a guideline with id "${guideline.id}" is already registered`, 'LOCAL_INFER_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: LocalInfer) {
      this.guidelineRegistry.set(guideline.id, guideline)
      yield () => {
        this.guidelineRegistry.delete(guideline.id)
      }
    }.bind(this), 'localInfer.registerGuideline()')
    return () => void dispose()
  }

  registerVramModel(model: VramModel): () => void {
    const id = model.id
    if (id.trim() === '') {
      throw new LocalInferError('a VramModel id must be a non-empty string', 'LOCAL_INFER_INVALID_MODEL')
    }
    if (this.vramModelRegistry.has(id)) {
      throw new LocalInferError(`a VramModel with id "${id}" is already registered`, 'LOCAL_INFER_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: LocalInfer) {
      this.vramModelRegistry.set(id, model)
      yield () => {
        this.vramModelRegistry.delete(id)
      }
    }.bind(this), 'localInfer.registerVramModel()')
    return () => void dispose()
  }

  registeredEngines(): readonly EngineAdapter[] {
    return [...this.engineRegistry.values()]
  }

  registeredPresets(): readonly Preset[] {
    return [...this.presetRegistry.values()]
  }

  registeredGuidelines(): readonly Guideline[] {
    return [...this.guidelineRegistry.values()]
  }

  registeredVramModels(): readonly VramModel[] {
    return [...this.vramModelRegistry.values()]
  }

  /**
   * registerDepPlan reserves the per-engine dep plan (the docker and local
   * SystemDep lists the providers ship as data). The deps entry point asks a
   * registered adapter's systemDeps first and falls back to this plan for the
   * engine id, so an adapter that declares its own toolchain wins.
   */
  registerDepPlan(engineId: string, plan: EngineDepPlan): () => void {
    if (engineId.trim() === '') {
      throw new LocalInferError('a dep plan engine id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE')
    }
    if (this.depPlanRegistry.has(engineId)) {
      throw new LocalInferError(`a dep plan for engine "${engineId}" is already registered`, 'LOCAL_INFER_CONFLICT')
    }

    const dispose = this.ctx.effect(function* (this: LocalInfer) {
      this.depPlanRegistry.set(engineId, plan)
      yield () => {
        this.depPlanRegistry.delete(engineId)
      }
    }.bind(this), 'localInfer.registerDepPlan()')
    return () => void dispose()
  }

  registeredDepPlans(): ReadonlyMap<string, EngineDepPlan> {
    return this.depPlanRegistry
  }

  /**
   * registerEnginePlatformConfig stores the per-engine platform config (the
   * Engine Directory and Engine Fork the user adds for a specific engine). The
   * launch and deploy steps resolve it against the global modelDirectory to
   * produce the clone/build/download plan. A duplicate id replaces the stored
   * config, because a user editing the fields for an engine re-saves the whole
   * config rather than reserving a second slot.
   */
  registerEnginePlatformConfig(config: EnginePlatformConfig): () => void {
    const id = config.engineId
    if (id.trim() === '') {
      throw new LocalInferError(
        'an engine platform config id must be a non-empty string',
        'LOCAL_INFER_INVALID_ENGINE',
      )
    }
    this.platformConfigRegistry.set(id, config)
    return () => {
      this.platformConfigRegistry.delete(id)
    }
  }

  /**
   * enginePlatformConfig reads the stored platform config for an engine id, or
   * undefined when none is stored, which the deploy step reads as "use the
   * adapter's default source and a managed cache directory".
   */
  enginePlatformConfig(engineId: string): EnginePlatformConfig | undefined {
    return this.platformConfigRegistry.get(engineId)
  }

  async estimate(config: Config, hw: HardwareProfile): Promise<EstimateResult> {
    const model = this.resolveVramModel(config)
    const estimate = estimateVram(model, config, hw)
    return { breakdown: estimate.breakdown, verdict: estimate.verdict, source: estimate.source }
  }

  /**
   * detectHardware runs the host probes (nvidia-smi, docker, WSL2, OS, CPU,
   * RAM) and turns their results into the HardwareProfile every relationship
   * consumes. A probe that fails or times out degrades to "not available"
   * for that capability, so detection never throws on a bare host.
   */
  async detectHardware(): Promise<HardwareProfile> {
    const probes = await runHardwareProbes()
    return detectHardwareFromProbes(probes)
  }

  /**
   * guidelines runs the full guideline engine over a config and a hardware
   * profile: the registered named guidelines, every per-spec hardware
   * constraint of the registered engines, and the model-aware rules that
   * price against the resolved VramModel (the estimator-backed "exceeds
   * usable VRAM" and "spec needs draft weights" rules). The result list is
   * the single source the UI banner and the inline red warnings render from.
   */
  async guidelines(config: Config, hw: HardwareProfile): Promise<GuidelineResult[]> {
    const results = evaluateGuidelines(
      this.registeredGuidelines(),
      this.collectSpecs(),
      config,
      hw,
    )
    const model = this.resolveVramModel(config)
    if (model !== undefined) {
      for (const result of modelGuidelines(model, config, hw)) {
        results.push(result)
      }
    }
    return results
  }

  /**
   * deps resolves the host deps an engine's deploy step needs for a build
   * mode. A registered adapter that declares systemDeps wins; the provider-
   * registered plan for the engine id is the fallback, and an engine with
   * neither plans an empty list (nothing to install, the gate passes).
   */
  async deps(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<readonly SystemDep[]> {
    const adapter = this.engineRegistry.get(engineId)
    if (adapter !== undefined && typeof adapter.systemDeps === 'function') {
      return adapter.systemDeps(buildMode, hw)
    }
    return this.depPlanRegistry.get(engineId)?.[buildMode] ?? []
  }

  /**
   * installString renders the copy/paste block for the resolved dep plan,
   * keyed to the detected package manager, with the by-hand note for a dep
   * the manager has no commands for.
   */
  async installString(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<string> {
    const deps = await this.deps(engineId, buildMode, hw)
    return renderInstallString(deps, hw)
  }

  /**
   * runInstall is the Play/Run path: it runs the resolved dep plan's commands
   * through the shell runner and re-probes each dep. The runner captures the
   * per-command exit, so a failure names the command that broke.
   */
  async runInstall(engineId: string, buildMode: 'docker' | 'local', hw: HardwareProfile): Promise<InstallResult> {
    const deps = await this.deps(engineId, buildMode, hw)
    return runInstall(deps, hw, shellRunCommand)
  }

  /**
   * launch is the lifecycle entry point: it resolves the adapter that rendered
   * the plan (by the plan's engineId), runs the adapter's deploy step (build
   * or pull, download the model, start the engine) with the stored platform
   * config, then polls the health URL until the engine reports 200. A deploy
   * failure or a health timeout reads as not-healthy with the detail, so the
   * UI shows the broken step rather than a blank panel.
   */
  async launch(plan: LaunchPlan, options?: LaunchOptions): Promise<LaunchResult> {
    const adapter = this.engineRegistry.get(plan.engineId)
    if (adapter === undefined) {
      throw new LocalInferError(
        `no engine adapter is registered for "${plan.engineId}"`,
        'LOCAL_INFER_INVALID_ENGINE',
      )
    }
    const platform = this.platformConfigRegistry.get(plan.engineId)
    const deployResult = await adapter.deploy(plan, platform)
    if (!deployResult.ok) {
      // exactOptionalPropertyTypes: only write the detail key when it is present.
      const result: LaunchResult = { plan, healthy: false }
      if (deployResult.detail !== undefined) {
        result.detail = deployResult.detail
      }
      return result
    }
    const health = await adapter.healthCheck(plan, options)
    const launchResult: LaunchResult = { plan, healthy: health.healthy }
    if (health.detail !== undefined) {
      launchResult.detail = health.detail
    }
    return launchResult
  }

  /**
   * stop signals the engine a launch started: it resolves the adapter by the
   * plan's engineId and runs the adapter's stop step (kill the tracked process,
   * stop the named container, or compose down).
   */
  async stop(plan: LaunchPlan): Promise<void> {
    const adapter = this.engineRegistry.get(plan.engineId)
    if (adapter === undefined) {
      throw new LocalInferError(
        `no engine adapter is registered for "${plan.engineId}"`,
        'LOCAL_INFER_INVALID_ENGINE',
      )
    }
    await adapter.stop(plan)
  }

  /**
   * registerModel publishes a confirmed-working engine as a DSH model. It
   * builds the entry from the plan (the provider id, the base URL, and the
   * API-key env name derive from the engine id), reads the llm-pi-ai section
   * through the settings seam, and upserts the provider's models list with a
   * path-addressed mutate guarded by the section's revision, so a stale
   * write is refused rather than overwriting a concurrent edit. Re-running
   * with the same model replaces the row in place, never duplicating it.
   * With agentDefault, the agent default model section points at the new
   * provider and model, so a new session starts from the local engine.
   */
  async registerModel(
    plan: LaunchPlan,
    model: ModelRow,
    options?: RegisterModelOptions,
  ): Promise<RegisterResult> {
    const settings = this.settings()
    const entry = buildModelEntry(plan, model)
    const llm = this.descriptor(settings, LLM_PI_AI_NAMESPACE)
    const rows = modelRowsFrom(llm?.value, entry.providerId)
    await settings.mutate(
      LLM_PI_AI_NAMESPACE,
      providerRegistrationOps(entry, rows),
      llm?.revision,
    )
    if (options?.agentDefault === true) {
      const agent = this.descriptor(settings, AGENT_DEFAULT_MODEL_NAMESPACE)
      await settings.mutate(
        AGENT_DEFAULT_MODEL_NAMESPACE,
        agentDefaultOps(entry.providerId, model.id),
        agent?.revision,
      )
    }
    return { ok: true, entry }
  }

  /**
   * removeModel removes a registered model from its provider: the models
   * list without the row, the whole provider when the row was the last one,
   * and the agent default section cleared when it pointed at the removed
   * pair. Removing a model the provider does not carry is a no-op, so a
   * stop with nothing registered stays quiet.
   */
  async removeModel(providerId: string, modelId: string): Promise<void> {
    const settings = this.settings()
    const llm = this.descriptor(settings, LLM_PI_AI_NAMESPACE)
    const rows = modelRowsFrom(llm?.value, providerId)
    // A provider the section does not carry removes nothing: a stop with
    // nothing registered stays quiet, so no write and no revision bump.
    if (rows.length > 0) {
      const ops = providerRemovalOps(providerId, removeModelRow(rows, modelId))
      await settings.mutate(LLM_PI_AI_NAMESPACE, ops, llm?.revision)
    }
    const agent = this.descriptor(settings, AGENT_DEFAULT_MODEL_NAMESPACE)
    if (agent !== undefined && agentDefaultPointsAt(agent.value, providerId, modelId)) {
      await settings.mutate(
        AGENT_DEFAULT_MODEL_NAMESPACE,
        agentDefaultUnsetOps(),
        agent.revision,
      )
    }
  }

  /**
   * resolveDefaults resolves the starting Config for an engine, model, and
   * detected hardware over the registered presets and the engine's parameter
   * surface. The resolution order (explicit value, exact-class preset,
   * built-in preset, spec default) and the per-key provenance are the core
   * resolver's, so the meter, the form, and the DSH contextWindow all price
   * the same starting config.
   */
  async resolveDefaults(
    engineId: string,
    modelId: string,
    hw: HardwareProfile,
    explicit?: Config,
  ): Promise<ResolvedDefaults> {
    const specs = this.specsForEngine(engineId)
    return resolveDefaultsFromPresets(
      this.registeredPresets(),
      specs,
      engineId,
      modelId,
      hw,
      explicit,
    )
  }

  /**
   * fetchPreset is the mod-search fetch path: it runs the bridge over the
   * source's URL, extracts the values with the source's pure extractor, tags
   * the result with the URL and the fetch date, persists it to the preset
   * store, and registers it so the next resolveDefaults uses it. When the
   * bridge is unavailable (no CLI, a failed fetch) it degrades to a
   * not-stored, degraded answer so the caller falls back to the built-in
   * presets and says so.
   */
  async fetchPreset(
    source: PresetSource,
    options?: FetchPresetOptions,
  ): Promise<FetchPresetResult> {
    const cliPath = await this.resolveModsearchCli(options?.cliPath)
    if (cliPath === null) {
      return {
        preset: undefined,
        stored: false,
        degraded: true,
        detail: 'the modsearch CLI is not available; the built-in presets apply',
      }
    }
    let content: string
    try {
      content = await this.fetchPage(source.url, cliPath)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        preset: undefined,
        stored: false,
        degraded: true,
        detail: `the modsearch fetch failed: ${detail}; the built-in presets apply`,
      }
    }
    const preset = presetFromFetch(source, content, todayIso())
    this.storePreset(preset)
    this.registerIfNew(preset)
    return { preset, stored: true, degraded: false }
  }

  /**
   * specsForEngine reads the parameter surface of the registered adapter for
   * an engine id, so the defaults resolver floors the result on that engine's
   * own spec defaults. An engine no adapter serves floors on an empty
   * surface, which reads as "no spec defaults" rather than a collision.
   */
  private specsForEngine(engineId: string): readonly ParameterSpec[] {
    const adapter = this.engineRegistry.get(engineId)
    if (adapter === undefined) return []
    return adapter.parameters()
  }

  /**
   * resolveModsearchCli finds the modsearch CLI script the fetch path spawns.
   * An injected cliPath wins, then the MODSEARCH_CLI env, then the modsearch
   * bin on PATH. None found reads as the bridge being unavailable, which
   * fetchPreset degrades on.
   */
  private async resolveModsearchCli(cliPath?: string): Promise<string | null> {
    if (cliPath !== undefined && cliPath.trim() !== '') return cliPath
    const env = process.env.MODSEARCH_CLI
    if (env !== undefined && env.trim() !== '') return env
    const which = await runCommand('which', ['modsearch'])
    if (which.ok && which.stdout.trim() !== '') return which.stdout.trim()
    return null
  }

  /**
   * fetchPage runs the modsearch CLI over one URL and reads the fetched page
   * content out of its JSON answer. The CLI's fetch schema carries a
   * `content` string; a non-JSON answer or a nonzero exit reads as a failed
   * fetch, which the caller degrades on.
   */
  private fetchPage(url: string, cliPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'node',
        [cliPath, 'search', '-u', url, '--deadline', '60000'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (error) => {
        reject(new Error(`the modsearch CLI failed to start: ${error.message}`))
      })
      child.on('close', (code) => {
        if (code === 0) {
          try {
            // The CLI's fetch answer nests the page under results[0].content;
            // a top-level content (a search answer) is read the same way.
            const parsed = JSON.parse(stdout) as {
              content?: unknown
              results?: readonly { content?: unknown }[]
            }
            const first = parsed.results?.[0]
            const content = typeof parsed.content === 'string' ? parsed.content : first?.content
            resolve(typeof content === 'string' ? content : '')
          } catch (error) {
            reject(new Error(`the modsearch CLI returned non-JSON output: ${(error as Error).message}`))
          }
          return
        }
        reject(new Error(`the modsearch CLI exited ${code}: ${stderr.trim().slice(-512)}`))
      })
    })
  }

  /**
   * storePreset persists a fetched preset to the preset store, replacing any
   * stored preset with the same (engine, model, class) key so a re-fetch
   * refreshes in place rather than duplicating.
   */
  private storePreset(preset: Preset): void {
    const path = presetStorePath()
    mkdirSync(dirname(path), { recursive: true })
    const key = presetKey(preset)
    const next = this.readPresetStore().filter((entry) => presetKey(entry) !== key)
    next.push(preset)
    writeFileSync(path, JSON.stringify(next, null, 2))
  }

  /**
   * readPresetStore reads the stored presets, degrading a missing or broken
   * file to an empty list so a first fetch starts a fresh store.
   */
  private readPresetStore(): Preset[] {
    const path = presetStorePath()
    if (!existsSync(path)) return []
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return Array.isArray(parsed) ? (parsed as Preset[]) : []
    } catch {
      return []
    }
  }

  /**
   * registerIfNew registers a fetched preset with the seam, skipping the
   * write when the preset's key is already reserved, so a re-fetch of a
   * built-in triple does not trip the duplicate-id conflict.
   */
  private registerIfNew(preset: Preset): void {
    if (this.presetRegistry.has(presetKey(preset))) return
    this.registerPreset(preset)
  }

  /**
   * settings narrows the context to the dsh settings service the registrar
   * writes through. A profile without the service (a headless install) fails
   * loudly with a stable code, so a caller never mistakes "no seam" for a
   * published model.
   */
  private settings(): SettingsForms {
    const settings = (this.ctx as Context & { settings?: SettingsForms }).settings
    if (settings === undefined) {
      throw new LocalInferError(
        'the dsh settings service is not available in this profile',
        'LOCAL_INFER_SETTINGS_UNAVAILABLE',
      )
    }
    return settings
  }

  /**
   * descriptor reads one settings entry by namespace key. The read requests
   * secret redaction, because the registrar prices the section it edits and
   * a secret value must never ride into the core's pure ops.
   */
  private descriptor(
    settings: SettingsForms,
    ns: string,
  ): SettingsNamespaceDescriptor | undefined {
    return settings.describe({ redactSecrets: true }).find((entry) => entry.ns === ns)
  }

  /**
   * Picks the VramModel an estimate prices against: the one the config names
   * by `model`, or the single registered model when the config names none.
   * Zero or several candidates with no name leave the estimate not-measured
   * rather than a guess.
   */
  private resolveVramModel(config: Config): VramModel | undefined {
    if (typeof config.model === 'string') {
      return this.vramModelRegistry.get(config.model)
    }
    const models = [...this.vramModelRegistry.values()]
    return models.length === 1 ? models[0] : undefined
  }

  /**
   * collectSpecs gathers the parameter surfaces of every registered engine,
   * deduped by key in registration order. A key two engines share (spec,
   * draftTokens, vision) keeps the first engine's spec, so a config warning
   * reads from one surface, not a collision.
   */
  private collectSpecs(): readonly ParameterSpec[] {
    const seen = new Set<string>()
    const specs: ParameterSpec[] = []
    for (const engine of this.engineRegistry.values()) {
      for (const spec of engine.parameters()) {
        if (seen.has(spec.key)) continue
        seen.add(spec.key)
        specs.push(spec)
      }
    }
    return specs
  }

}

/**
 * The stable registry key for a preset: its exact (engine, model, hardware
 * class) triple plus its label. A preset is only trusted for the triple it
 * was sourced for, and the label keeps the distinct tiers that share a triple
 * (the Hyper-Qwen speed, long-context, and huge-context presets) from
 * collapsing into one key.
 */
function presetKey(preset: Preset): string {
  return `${preset.engineId}/${preset.modelId}/${preset.hardwareClass}/${preset.label ?? ''}`
}

/**
 * presetStorePath is where fetched presets persist: under the dsh home so a
 * web user and a CLI user share one store, the way the config file does.
 */
function presetStorePath(): string {
  return join(homedir(), '.dsh', 'local-infer', 'presets.json')
}

/**
 * todayIso is the fetch date a fetched preset is tagged with, in the
 * YYYY-MM-DD form the UI renders beside the source.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * runCommand runs one probe command and reports whether it exited clean. A
 * missing binary or a timeout reads as not-ok, which the probes map to the
 * "capability not available" state.
 */
function runCommand(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      resolve({ ok: error === null, stdout: stdout ?? '' })
    })
  })
}

/**
 * The tail of the output the shell runner keeps on a failure. The full log
 * of a CUDA toolkit download is noise in a UI note; the last kilobyte names
 * the broken line.
 */
const INSTALL_OUTPUT_TAIL = 1024

/**
 * shellRunCommand is the Play/Run runner: it runs one command line through
 * the system shell and reports the exit. stdin is closed, so a sudo password
 * prompt that cannot read a terminal fails fast instead of hanging the panel;
 * the copy/paste path is the fallback the plan names for exactly this.
 */
const shellRunCommand = (command: string): Promise<CommandOutcome> =>
  new Promise(resolve => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > INSTALL_OUTPUT_TAIL * 2) {
        output = output.slice(-INSTALL_OUTPUT_TAIL * 2)
      }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('close', code => {
      if (code === 0) {
        resolve({ ok: true })
        return
      }
      resolve({ ok: false, detail: `exit ${code}: ${output.trim().slice(-INSTALL_OUTPUT_TAIL)}` })
    })
  })

/**
 * probeGpu reads the GPU through nvidia-smi's CSV query. Any failure (no
 * nvidia-smi, no GPU, a hung daemon) degrades to null, which detection reads
 * as "no GPU" and the estimator reads as a zero usable budget.
 */
async function probeGpu(): Promise<GpuProbe | null> {
  const result = await runCommand('nvidia-smi', [
    '--query-gpu=name,memory.total,compute_cap',
    '--format=csv,noheader',
  ])
  return result.ok ? parseNvidiaSmiGpu(result.stdout) : null
}

/**
 * probeDocker checks for the docker binary. `docker --version` needs no
 * running daemon, so the flag means "docker is installed", not "the daemon
 * is up"; the deploy step is where a down daemon surfaces.
 */
async function probeDocker(): Promise<boolean> {
  const result = await runCommand('docker', ['--version'])
  return result.ok
}

/**
 * probePackageManager checks which of the four package-manager binaries exist
 * on the host. `which` is a read-only probe, so each answer is a plain
 * presence flag the pure detectPackageManager mapping turns into the winner.
 */
async function probePackageManager(binary: string): Promise<boolean> {
  const result = await runCommand('which', [binary])
  return result.ok
}

/**
 * runHardwareProbes collects the raw probe results the detector consumes: the
 * OS, CPU thread count, host RAM, the GPU reading, docker availability,
 * WSL2, and the package-manager winner. The WSL2 read is a kernel-release
 * check (WSL2 kernels carry a "microsoft-standard-WSL2" suffix), which needs
 * no child process.
 */
export async function runHardwareProbes(): Promise<HardwareProbes> {
  const osMap: Record<string, 'linux' | 'windows' | 'macos'> = {
    linux: 'linux',
    win32: 'windows',
    darwin: 'macos',
  }
  const os = osMap[platform()] ?? 'linux'
  const [gpu, dockerAvailable, apt, dnf, pacman, brew] = await Promise.all([
    probeGpu(),
    probeDocker(),
    probePackageManager('apt-get'),
    probePackageManager('dnf'),
    probePackageManager('pacman'),
    probePackageManager('brew'),
  ])
  return {
    os,
    cpuThreads: availableParallelism() || cpus().length,
    dockerAvailable,
    wsl2: os === 'linux' && release().toLowerCase().includes('wsl'),
    hostRamGiB: totalmem() / 2 ** 30,
    gpu,
    packageManager: detectPackageManager({ os, apt, dnf, pacman, brew }) ?? null,
  }
}

export default LocalInfer
