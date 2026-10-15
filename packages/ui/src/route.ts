/**
 * The webServer routes the Web card talks to. GET /local-infer/summary
 * returns the engine list, the detected hardware, the form model for the
 * selected engine, the VRAM meter model for the current config, the default
 * model list and the model status (presence, hf CLI, download command) the
 * banner and inline red warnings render from; POST /local-infer/save persists
 * the config; POST /local-infer/download runs the hf CLI download for a
 * default model; POST /local-infer/launch and /local-infer/stop drive the
 * engine lifecycle; and POST /local-infer/register and /local-infer/
 * unregister publish the engine as a DSH model through the settings seam.
 * The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The routes are held by an effect, so they
 * go when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Config,
  DefaultProvenance,
  EnginePlatformConfig,
  HardwareProfile,
  InstallResult,
  ModelRow,
  ProviderStatus,
  RegisterResult,
  VramModel,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'
import type {
  DownloadResult,
  LaunchResult,
  LocalInferService,
  RegisterModelOptions,
} from '@dsh/dsh-plugin-local-infer/service'
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import {
  checkDeps,
  DEFAULT_LOG_PATH_TEMPLATE,
  hfDownloadCommand,
  modelArtifactPath,
  modelEntriesForEngine,
  providerIdFor,
  renderInstallString,
  resolveLogPath,
} from '../../core/lib/index.js'
import {
  defaultModelFor,
  defaultModelsForEngine,
  ENGINES,
} from '../../providers/lib/index.js'
import type { EngineInfo } from '../../providers/lib/index.js'
import { renderDeps } from './deps.ts'
import type { DepsModel } from './deps.ts'
import { renderForm } from './form.ts'
import type { FormModel } from './form.ts'
import { renderMeter } from './meter.ts'
import type { MeterModel } from './meter.ts'
import { renderWarnings } from './warnings.ts'
import type { WarningsModel } from './warnings.ts'

/**
 * The webServer service is dsh-specific and absent from the cordis Context
 * type, so the route narrows the scoped context to the two members it needs.
 */
export interface WebServerService {
  register(route: {
    name: string
    kind: 'exact'
    path: string
    handler: (req: IncomingLike, res: OutgoingLike) => void | Promise<void>
  }): () => void
}

interface IncomingLike extends AsyncIterable<Buffer> {
  method: string
  url: string
  destroy(): void
}

interface OutgoingLike {
  writeHead(status: number, headers?: Record<string, string>): OutgoingLike
  end(body?: string): void
}

/**
 * LocalInferSummary is the JSON the card renders: the engine list, the model
 * list, the detected hardware, the form model for the selected engine, the
 * meter model for the current config, the verdict the banner renders, the
 * guideline warning model the red banner and inline warnings render from,
 * and the config the form edits. Every field is plain data, so it crosses
 * the socket without a function left behind.
 */
export interface LocalInferSummary {
  engines: { id: string; label: string; supports: { docker: boolean; local: boolean } }[]
  models: { id: string; source: string }[]
  hardware: HardwareProfile
  engineId: string
  formModel: FormModel
  meterModel: MeterModel
  verdict: VramVerdict
  warningsModel: WarningsModel
  config: Config
  // The per-engine platform configs (§3.10) the card's Engine Directory and
  // Engine Fork fields edit, keyed by engine id.
  platformConfigs: Record<string, StoredPlatformConfig>
  // The resolved defaults for the selected engine and model: the starting
  // config and the per-key provenance the card shows as "sourced from X".
  defaults: DefaultsModel
  // The plugin's model download directory (~/.dsh/models, created when
  // absent), the value the card's Model Directory field seeds from.
  modelDirectory: string
  // The default model list for the selected engine: the entries the card's
  // Model dropdown offers, in list order. An engine with no entry (Strata)
  // carries an empty list.
  modelDefaults: ModelDefaultModel[]
  // The model status for the selected model: presence in the model
  // directory, the hf CLI probe, and the download command the card's
  // Download button runs. Null when no default entry names the model.
  modelStatus: ModelStatusModel | null
  // The model files the directory scan found in the model directory for
  // the selected engine: the `.ninfer` artifacts NInfer serves, the `.gguf`
  // files llama.cpp serves, and the repo directories Hyper-Qwen consumes.
  // The card's Model dropdown offers them beside the defaults, so a model
  // the user already has on disk is selectable and launchable as-is.
  modelFiles: string[]
  // The stored help toggle: whether the card shows the per-field
  // descriptions. The card's "?" button flips it and the save route
  // persists it, so the preference survives a reload.
  showHelp: boolean
  // The saved provider configs the card lists, each with the running-state
  // its status dot paints (green running, red stopped, yellow unsure). The
  // card renders these as collapsed entries at the top of the panel, each
  // with its Edit and Delete controls.
  providers: ProviderSummaryEntry[]
  // The log-file location template the card's log-location field edits, and
  // the last run's captured log output the card's Logs section shows. A launch
  // overwrites lastLogs and writes the engine's output to the resolved path.
  logPath: string
  lastLogs: string
}

/**
 * ProviderSummaryEntry is the card-facing view of one saved provider config:
 * the stable id the card edits and deletes against, the engine and model the
 * title renders ("NInfer: <model>"), the running-state the status dot paints,
 * and the full config and platform the expanded form draws from.
 */
export interface ProviderSummaryEntry {
  id: string
  engine: string
  model: string
  status: ProviderStatus
  config: Config
  platform: StoredPlatformConfig
}

/**
 * ModelDefaultModel is the card-facing view of one default model entry: the
 * registry key the config `model` field carries, the label the dropdown
 * shows, and the Hugging Face URL the no-CLI row links to.
 */
export interface ModelDefaultModel {
  id: string
  label: string
  url: string
}

/**
 * ModelStatusModel is the model-status read model the card draws: whether the
 * model is present in the model directory, whether the hf CLI is available,
 * and the download command the Download button runs. The card shows the row
 * only while the model is absent.
 */
export interface ModelStatusModel {
  modelId: string
  label: string
  url: string
  present: boolean
  hfCli: boolean
  downloadCommand: string
}

/**
 * DefaultsModel is the resolved-defaults read model the card draws: the
 * starting config the defaults resolver produced and the per-key provenance
 * that names the source that supplied each value (a preset, the user, or a
 * spec default).
 */
export interface DefaultsModel {
  config: Config
  provenance: DefaultProvenance[]
}

/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export function localInferConfigPath(): string {
  return join(homedir(), '.dsh', 'local-infer', 'config.json')
}

/**
 * StoredPlatformConfig is the per-engine platform config the deploy step
 * consumes (§3.10): where the engine platform lives locally and the git repo
 * that overrides the engine's default upstream. The map is keyed by engine id,
 * so the stored entry carries no id of its own; the route adds it when it
 * builds the EnginePlatformConfig the service registry stores.
 */
export interface StoredPlatformConfig {
  engineDirectory?: string
  engineFork?: string
}

/**
 * StoredProviderConfig is one saved provider model+engine config the card
 * lists: a stable id the card edits and deletes against, the engine and the
 * full parameter config it serves, and the per-engine platform config the
 * deploy step consumes. A Save adds a new entry (or updates one by id), so
 * the card lists every provider the user has configured, not just the one
 * currently being edited.
 */
export interface StoredProviderConfig {
  id: string
  engine: string
  config: Config
  platform: StoredPlatformConfig
}

export interface StoredConfig {
  engine: string
  config: Config
  // The Play/Run trust gate (the plan's allowRunDeps): one-click install runs
  // package-manager commands, often as root, so it stays off until the user
  // says the add-on may.
  allowRunDeps: boolean
  // The per-engine platform configs (§3.10): the Engine Directory and Engine
  // Fork the user adds for a specific engine, keyed by engine id.
  platform: Record<string, StoredPlatformConfig>
  // The card's help toggle: show the per-field descriptions. The default is
  // on, so a file that predates the key reads as descriptions visible.
  showHelp: boolean
  // The saved provider configs the card lists, newest first. A file that
  // predates the key carries an empty list, so a first Save adds the first
  // provider entry rather than overwriting a missing one.
  providers: StoredProviderConfig[]
  // The log-file location template the card's log-location field edits. The
  // launch step resolves its placeholders (engine, model slug, timestamp) and
  // writes the engine's output there. The default is the plugin's log dir.
  logPath: string
  // The last run's captured log output, kept so the card's Logs section shows
  // the previous run after a reload. A launch overwrites it with the new run.
  lastLogs: string
}

/**
 * readConfig reads the stored engine, config, trust gate, and per-engine
 * platform configs. A missing or broken file reads as the scaffold default
 * (NInfer, empty config, gate off, no platform configs) so the card always has
 * a form to draw. A platform entry that is not an object (or whose fields are
 * not strings) is dropped, so a by-hand edit never poisons the deploy step.
 */
export function readConfig(): StoredConfig {
  const path = localInferConfigPath()
  if (!existsSync(path)) {
    return {
      engine: 'ninfer',
      config: {},
      allowRunDeps: false,
      platform: {},
      showHelp: true,
      providers: [],
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      engine?: unknown
      config?: unknown
      allowRunDeps?: unknown
      platform?: unknown
      showHelp?: unknown
      providers?: unknown
      logPath?: unknown
      lastLogs?: unknown
    }
    return {
      engine: typeof parsed.engine === 'string' ? parsed.engine : 'ninfer',
      config: parsed.config && typeof parsed.config === 'object' ? (parsed.config as Config) : {},
      allowRunDeps: typeof parsed.allowRunDeps === 'boolean' ? parsed.allowRunDeps : false,
      platform: parsePlatformConfigs(parsed.platform),
      // A file that predates the key (or carries a non-boolean) reads as
      // descriptions visible, the default the card draws on first open.
      showHelp: typeof parsed.showHelp === 'boolean' ? parsed.showHelp : true,
      providers: parseProviders(parsed.providers),
      // A file that predates the key reads as the plugin's default log dir,
      // and the last-run logs start empty until a launch fills them.
      logPath: typeof parsed.logPath === 'string' && parsed.logPath !== ''
        ? parsed.logPath
        : DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: typeof parsed.lastLogs === 'string' ? parsed.lastLogs : '',
    }
  } catch {
    return {
      engine: 'ninfer',
      config: {},
      allowRunDeps: false,
      platform: {},
      showHelp: true,
      providers: [],
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
    }
  }
}

/**
 * parseProviders reads the stored provider list, keeping only entries with a
 * non-blank string id. A non-object entry or an entry with no id is dropped,
 * so a by-hand edit never poisons the card's provider list. The per-engine
 * platform config is read through the same string-field rule the platform map
 * uses, so a provider never carries a platform field it cannot price.
 */
function parseProviders(raw: unknown): StoredProviderConfig[] {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw)) {
    return []
  }
  const providers: StoredProviderConfig[] = []
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const fields = entry as Record<string, unknown>
    if (typeof fields.id !== 'string' || fields.id.trim() === '') continue
    const engine = typeof fields.engine === 'string' ? fields.engine : 'ninfer'
    const config = fields.config && typeof fields.config === 'object' ? (fields.config as Config) : {}
    const platform = parseStoredPlatformConfig(fields.platform) ?? {}
    providers.push({ id: fields.id, engine, config, platform })
  }
  return providers
}

/**
 * newProviderId mints the stable id a new provider entry carries: a
 * timestamp base plus a random tail, so two Saves in the same tick never
 * collide. The card edits and deletes against this id.
 */
function newProviderId(): string {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * writeConfig persists the engine, config, trust gate, per-engine platform
 * configs, and the help toggle, creating the directory tree on first write.
 */
export function writeConfig(
  engine: string,
  config: Config,
  allowRunDeps: boolean,
  platform?: Record<string, StoredPlatformConfig>,
  showHelp?: boolean,
  providers?: StoredProviderConfig[],
  logPath?: string,
  lastLogs?: string,
): void {
  const path = localInferConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify(
      {
        engine,
        config,
        allowRunDeps,
        platform: platform ?? {},
        showHelp: showHelp ?? true,
        providers: providers ?? [],
        logPath: logPath ?? DEFAULT_LOG_PATH_TEMPLATE,
        lastLogs: lastLogs ?? '',
      },
      null,
      2,
    ),
  )
}

/**
 * parsePlatformConfigs reads the stored platform map, keeping only entries
 * whose fields are strings. A non-object map or a non-object entry reads as
 * absent, so the deploy step never sees a platform config it cannot price.
 */
function parsePlatformConfigs(raw: unknown): Record<string, StoredPlatformConfig> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const platform: Record<string, StoredPlatformConfig> = {}
  for (const [engineId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    const stored: StoredPlatformConfig = {}
    const fields = entry as Record<string, unknown>
    if (typeof fields.engineDirectory === 'string') {
      stored.engineDirectory = fields.engineDirectory
    }
    if (typeof fields.engineFork === 'string') {
      stored.engineFork = fields.engineFork
    }
    if (stored.engineDirectory !== undefined || stored.engineFork !== undefined) {
      platform[engineId] = stored
    }
  }
  return platform
}

/**
 * parseStoredPlatformConfig reads one engine's platform config (the launch
 * request's `platform` key), keeping only string fields. A non-object or an
 * object with no string fields reads as absent, so the launch keeps the stored
 * entry the save route synced.
 */
function parseStoredPlatformConfig(raw: unknown): StoredPlatformConfig | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const fields = raw as Record<string, unknown>
  const stored: StoredPlatformConfig = {}
  if (typeof fields.engineDirectory === 'string') {
    stored.engineDirectory = fields.engineDirectory
  }
  if (typeof fields.engineFork === 'string') {
    stored.engineFork = fields.engineFork
  }
  if (stored.engineDirectory === undefined && stored.engineFork === undefined) {
    return undefined
  }
  return stored
}

/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, the meter model the
 * service's estimate prices, and the warning model the service's guideline
 * engine fires. The estimate is the single source the meter and the verdict
 * banner agree on, and the guideline results are the single source the red
 * banner and the inline warnings agree on.
 */
export async function buildSummary(
  localInfer: LocalInferService,
  request?: { engine?: string; config?: Config },
): Promise<LocalInferSummary> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  // ENGINES is a known non-empty constant, so the fallback is always defined.
  const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0]!
  // The Model Directory field defaults to the plugin's model download
  // directory (~/.dsh/models, created when absent), so the card always
  // seeds a real path the deploy step can target. A stored or requested
  // directory that is a non-blank string wins over the default.
  const modelDirectory = localInfer.defaultModelDirectory()
  const rawConfig = request?.config ?? stored.config
  const config: Config =
    typeof rawConfig.modelDirectory === 'string' && rawConfig.modelDirectory.trim() !== ''
      ? rawConfig
      : { ...rawConfig, modelDirectory }
  const modelDir = typeof config.modelDirectory === 'string' ? config.modelDirectory : modelDirectory
  const hardware = await localInfer.detectHardware()
  // The engine id rides into both entry points: the estimate's OS-reserve
  // resolution runs the plugin-launched check against it, and the
  // model-aware guidelines price the same usable budget the meter does.
  const estimate = await localInfer.estimate(config, hardware, engine.id)
  const guidelineResults = await localInfer.guidelines(config, hardware, engine.id)
  // The defaults list is the Model field's "Defaults" special case: a config
  // with no model names the engine's first default model, so the meter, the
  // form seed, and the model status all price the same starting model.
  const engineDefaults = defaultModelsForEngine(engine.id)
  const modelId =
    typeof config.model === 'string' ? config.model : (engineDefaults[0]?.modelId ?? engine.id)
  const defaults = await localInfer.resolveDefaults(engine.id, modelId, hardware, config)
  // The directory scan lists the model files the selected engine can serve
  // straight from the model directory, so the card's Model dropdown offers
  // them beside the defaults. A missing directory reads as an empty list.
  const modelFiles = modelEntriesForEngine(localInfer.listModelDirectory(modelDir), engine.id)
  // The model status checks the selected model against the model directory
  // and probes the hf CLI, so the card shows its Download row (or the URL
  // row) only while the model is absent.
  const entry = defaultModelFor(engine.id, modelId)
  let modelStatus: ModelStatusModel | null = null
  if (entry !== undefined) {
    const present = existsSync(modelArtifactPath(entry, modelDir))
    const hfCli = (await localInfer.hfCliAvailable()) !== null
    modelStatus = {
      modelId: entry.modelId,
      label: entry.label,
      url: entry.url,
      present,
      hfCli,
      downloadCommand: hfDownloadCommand(entry, modelDir),
    }
  }
  // The provider list the card renders as collapsed entries: each saved
  // config's engine and model feed the detector, which resolves the running-
  // state its status dot paints. A provider the detector cannot tie to a
  // confirmed model reads as unsure, so the dot never overstates a live
  // engine.
  const providerRefs = stored.providers.map((provider) => {
    const model = typeof provider.config.model === 'string' ? provider.config.model : undefined
    // exactOptionalPropertyTypes: include the model key only when it is a
    // string, so a config that names no model never writes `undefined`.
    return model !== undefined
      ? { id: provider.id, engine: provider.engine, model }
      : { id: provider.id, engine: provider.engine }
  })
  const providerStatuses =
    providerRefs.length > 0 ? await localInfer.providerStatuses(providerRefs) : {}
  const providers: ProviderSummaryEntry[] = stored.providers.map((provider) => ({
    id: provider.id,
    engine: provider.engine,
    model: typeof provider.config.model === 'string' ? provider.config.model : '',
    status: providerStatuses[provider.id] ?? 'unsure',
    config: provider.config,
    platform: provider.platform,
  }))
  return {
    engines: ENGINES.map((entry) => ({ id: entry.id, label: entry.label, supports: entry.supports })),
    models: localInfer.registeredVramModels().map((model) => ({ id: model.id, source: model.source })),
    hardware,
    engineId: engine.id,
    formModel: renderForm(engine.parameters, config),
    meterModel: renderMeter(
      estimate.breakdown,
      estimate.verdict,
      hardware.gpu?.vramGiB ?? 0,
      estimate.source,
      estimate.reserveSource,
    ),
    verdict: estimate.verdict,
    warningsModel: renderWarnings(guidelineResults),
    config,
    platformConfigs: stored.platform,
    defaults: { config: defaults.config, provenance: defaults.provenance },
    modelDirectory,
    modelDefaults: engineDefaults.map((entry) => ({
      id: entry.modelId,
      label: entry.label,
      url: entry.url,
    })),
    modelStatus,
    modelFiles,
    showHelp: stored.showHelp,
    providers,
    logPath: stored.logPath,
    lastLogs: stored.lastLogs,
  }
}

/**
 * RouteError is a route failure that carries its own HTTP status, so the
 * handlers map the domain answer (a gate that is off, an unsupported build
 * mode) to a status the card can read instead of a blanket 500.
 */
export class RouteError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RouteError'
    this.status = status
  }
}

/**
 * The route's view of which engine platform configs are registered with the
 * service, keyed by engine id. The service registry is the single source the
 * launch step reads, so the route keeps it in sync with the stored config:
 * on route registration, after every save, and when a launch request carries
 * a platform override. A disposer is tracked per engine, so an engine whose
 * stored config is cleared is unregistered rather than left stale.
 */
const platformDisposers = new Map<string, () => void>()

/**
 * setPlatformConfig registers one engine's platform config with the service,
 * replacing any stored entry. A config with no fields is read as "no platform
 * config", which unregisters the engine so the deploy step falls back to the
 * adapter's default source and cache directory.
 */
function setPlatformConfig(
  localInfer: LocalInferService,
  engineId: string,
  config: StoredPlatformConfig | undefined,
): void {
  platformDisposers.get(engineId)?.()
  platformDisposers.delete(engineId)
  if (config === undefined) {
    return
  }
  if (config.engineDirectory === undefined && config.engineFork === undefined) {
    return
  }
  const platform: EnginePlatformConfig = { engineId, ...config }
  platformDisposers.set(engineId, localInfer.registerEnginePlatformConfig(platform))
}

/**
 * syncPlatformConfigs re-syncs the service registry with the stored platform
 * map: it registers (or re-registers) every engine that carries a config, and
 * unregisters every engine that no longer does, so a launch always reads the
 * platform config the user last saved.
 */
function syncPlatformConfigs(
  localInfer: LocalInferService,
  stored: StoredConfig,
): void {
  const wanted = stored.platform
  for (const engineId of [...platformDisposers.keys()]) {
    if (wanted[engineId] === undefined) {
      setPlatformConfig(localInfer, engineId, undefined)
    }
  }
  for (const [engineId, config] of Object.entries(wanted)) {
    setPlatformConfig(localInfer, engineId, config)
  }
}

/**
 * DepsRequest is the query the card sends for the deps panel: the engine and
 * the config the build mode reads from. Absent values fall back to the stored
 * config, the same rule the summary route applies.
 */
export interface DepsRequest {
  engine?: string
  config?: Config
}

/**
 * resolveBuildMode picks the deploy mode the dep plan prices: the config's
 * buildMode when the selected engine supports it, else the engine's default
 * (local when the engine can build locally, docker when it cannot). The
 * docker-not-installed guideline reads this same value, so the panel and the
 * warning never disagree about the mode.
 */
export function resolveBuildMode(engine: EngineInfo, config: Config): 'docker' | 'local' {
  const defaultMode: 'docker' | 'local' = engine.supports.local ? 'local' : 'docker'
  const requested = typeof config.buildMode === 'string' ? config.buildMode : undefined
  if ((requested === 'docker' || requested === 'local') && engine.supports[requested]) {
    return requested
  }
  return defaultMode
}

/**
 * buildDeps assembles the deps panel read model for one engine and config:
 * the detected hardware (with its package manager), the dep plan the service
 * resolves, the per-dep statuses, the copy/paste install string, and the
 * Play/Run trust gate the stored config carries.
 */
export async function buildDeps(localInfer: LocalInferService, request?: DepsRequest): Promise<DepsModel> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  // ENGINES is a known non-empty constant, so the fallback is always defined.
  const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0]!
  const buildMode = resolveBuildMode(engine, config)
  const hardware = await localInfer.detectHardware()
  const deps = await localInfer.deps(engine.id, buildMode, hardware)
  const checks = await checkDeps(deps, hardware)
  return renderDeps({
    engineId: engine.id,
    buildMode,
    packageManager: hardware.packageManager ?? null,
    checks,
    installString: renderInstallString(deps, hardware),
    runAllowed: stored.allowRunDeps,
  })
}

/**
 * InstallResponse is the answer to a Play/Run: the install result and the
 * refreshed deps model, so the card re-renders the gate from the same
 * re-check the install ran.
 */
export interface InstallResponse {
  result: InstallResult
  deps: DepsModel
}

/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 */
export async function runInstallFor(
  localInfer: LocalInferService,
  request: DepsRequest,
): Promise<InstallResponse> {
  if (readConfig().allowRunDeps !== true) {
    throw new RouteError(409, 'one-click install is not allowed; copy the install string instead')
  }
  const model = await buildDeps(localInfer, request)
  const hardware = await localInfer.detectHardware()
  const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware)
  const deps = model.deps.map((dep) => {
    const entry = result.results.find((entry) => entry.id === dep.id)
    return entry === undefined ? dep : { ...dep, status: entry.status }
  })
  return {
    result,
    deps: { ...model, deps, allSatisfied: result.ok },
  }
}

/**
 * DownloadRequest is the query the card sends for the download route: the
 * engine, model, and directory the hf CLI download targets. Absent values
 * fall back to the stored config, the same rule the summary route applies.
 */
export interface DownloadRequest {
  engine?: string
  model?: string
  directory?: string
}

/**
 * downloadFor runs the hf CLI download for the request's default model: it
 * resolves the entry through the providers' default list (a 404 when no
 * entry names the pair), resolves the directory against the request, the
 * stored config, and the plugin's default model directory in that order, and
 * runs the download through the service.
 */
export async function downloadFor(
  localInfer: LocalInferService,
  request: DownloadRequest,
): Promise<DownloadResult> {
  const stored = readConfig()
  const engineId = request.engine ?? stored.engine
  const modelId =
    request.model ?? (typeof stored.config.model === 'string' ? stored.config.model : '')
  const entry = defaultModelFor(engineId, modelId)
  if (entry === undefined) {
    throw new RouteError(404, `no default model is registered for "${engineId}/${modelId}"`)
  }
  const storedDir = stored.config.modelDirectory
  const directory =
    typeof request.directory === 'string' && request.directory.trim() !== ''
      ? request.directory
      : typeof storedDir === 'string' && storedDir.trim() !== ''
        ? storedDir
        : localInfer.defaultModelDirectory()
  return localInfer.downloadModel(entry, directory)
}

/**
 * LaunchRequest is the query the card sends for the launch and stop routes: the
 * engine and the config the plan renders from. `platform` carries the card's
 * unsaved Engine Directory / Engine Fork edits for the engine, so a launch uses
 * them without a prior save. Absent values fall back to the stored config, the
 * same rule the summary route applies.
 */
export interface LaunchRequest {
  engine?: string
  config?: Config
  platform?: StoredPlatformConfig
}

/**
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
function resolveAdapter(localInfer: LocalInferService, engineId: string) {
  const adapter = localInfer.registeredEngines().find((engine) => engine.id === engineId)
  if (adapter === undefined) {
    throw new RouteError(404, `no engine adapter is registered for "${engineId}"`)
  }
  return adapter
}

/**
 * launchEngine renders the plan the registered adapter produces for the config
 * and the detected hardware, then runs the service's launch entry point
 * (deploy, then the health poll). The detail the launch returns names the
 * broken step when the engine does not come up.
 */
export async function launchEngine(
  localInfer: LocalInferService,
  request: LaunchRequest,
): Promise<LaunchResult> {
  const stored = readConfig()
  const engineId = request.engine ?? stored.engine
  const config = request.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  // Register the request's platform override (the card's unsaved Engine
  // Directory / Engine Fork edits) so the service's launch resolves it against
  // the adapter's deploy step. An absent platform keeps the stored entry,
  // which the save route and route registration already synced.
  if (request.platform !== undefined) {
    setPlatformConfig(localInfer, engineId, request.platform)
  }
  const result = await localInfer.launch(adapter.renderLaunch(config, hardware))
  persistLaunchLogs(result, engineId, config)
  return result
}

/**
 * persistLaunchLogs stores a launch's captured output as the last run and
 * writes it to the configured log file. The log file is only written when the
 * run produced output and the log location is set; the last-run logs are always
 * persisted (an empty string clears a stale run) so the card's Logs section
 * shows the previous run after a reload.
 */
export function persistLaunchLogs(
  result: LaunchResult,
  engineId: string,
  config: Config,
): void {
  const stored = readConfig()
  const logs = result.logs ?? ''
  writeConfig(
    stored.engine,
    stored.config,
    stored.allowRunDeps,
    stored.platform,
    stored.showHelp,
    stored.providers,
    stored.logPath,
    logs,
  )
  if (logs === '') {
    return
  }
  const modelId = typeof config.model === 'string' ? config.model : undefined
  const logPath = resolveLogPath(stored.logPath, engineId, modelId, new Date(), homedir())
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, logs)
  } catch {
    // A log file that cannot be written (a read-only dir, a bad path) must not
    // fail the launch; the in-memory last-run logs still reach the card.
  }
}

/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started.
 */
export async function stopEngine(
  localInfer: LocalInferService,
  request: LaunchRequest,
): Promise<void> {
  const stored = readConfig()
  const engineId = request.engine ?? stored.engine
  const config = request.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  await localInfer.stop(adapter.renderLaunch(config, hardware))
}

/**
 * RegisterRequest is the query the card sends for the register and
 * unregister routes: the engine and the config the plan renders from, and
 * agentDefault, which points the agent default model at the registered
 * engine. Absent values fall back to the stored config, the same rule the
 * summary route applies.
 */
export interface RegisterRequest {
  engine?: string
  config?: Config
  agentDefault?: boolean
}

/**
 * resolveContextWindow picks the context window the registrar publishes: the
 * config's maxContext when it names one, else the native ceiling of the
 * VramModel the config resolves to (the named model, or the single
 * registered model), else the 32768 spec default. The DSH contextWindow must
 * not promise a context the engine cannot serve, so the ceiling is the
 * model's own, not an optimistic number.
 */
export function resolveContextWindow(config: Config, models: readonly VramModel[]): number {
  const configured = config.maxContext
  if (typeof configured === 'number' && configured > 0) {
    return configured
  }
  let model: VramModel | undefined
  if (typeof config.model === 'string') {
    model = models.find((entry) => entry.id === config.model)
  } else if (models.length === 1) {
    model = models[0]
  }
  return model?.nativeMaxContext ?? 32768
}

/**
 * resolveModelRow picks the model row the registrar publishes for an engine
 * and config: the adapter's modelRef (the id the engine serves on its
 * OpenAI endpoint) when it declares one, else the plan's model id, else the
 * engine id. The display name follows the same fall-through.
 */
function resolveModelRow(
  adapter: { id: string; modelRef?(config: Config): { id: string; name: string } | undefined },
  plan: { modelId?: string },
  config: Config,
): ModelRow {
  const ref = adapter.modelRef?.(config)
  const id = ref?.id ?? plan.modelId ?? adapter.id
  return { id, name: ref?.name ?? id, contextWindow: 0 }
}

/**
 * registerFor renders the plan through the registered adapter, resolves the
 * model row and the context window, and runs the service's register entry
 * point, which upserts the provider and model through the settings seam.
 * The result carries the entry the registrar wrote, so the card names the
 * model it published.
 */
export async function registerFor(
  localInfer: LocalInferService,
  request?: RegisterRequest,
): Promise<RegisterResult> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  const row = resolveModelRow(adapter, plan, config)
  row.contextWindow = resolveContextWindow(config, localInfer.registeredVramModels())
  const options: RegisterModelOptions | undefined =
    request?.agentDefault === true ? { agentDefault: true } : undefined
  return localInfer.registerModel(plan, row, options)
}

/**
 * unregisterFor runs the service's removeModel entry point for the engine's
 * provider and the model row the register step resolved, so the removal
 * targets the exact entry the registration wrote.
 */
export async function unregisterFor(
  localInfer: LocalInferService,
  request?: RegisterRequest,
): Promise<{ removed: boolean }> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  const row = resolveModelRow(adapter, plan, config)
  const buildMode = plan.kind === 'docker' ? 'docker' : 'local'
  await localInfer.removeModel(providerIdFor(adapter.id, row.id, buildMode), row.id)
  return { removed: true }
}

/**
 * registerLocalInferRoute registers the summary, save, deps, install, launch,
 * stop, register, and unregister routes on the web server and holds them by
 * an effect, so a bundle switch off removes them before the next switch on
 * re-registers. The scoped context carries the webServer; the localInfer
 * service is passed in because the scope only injects what it names.
 */
export function registerLocalInferRoute(
  scope: Context & { webServer: WebServerService },
  localInfer: LocalInferService,
): void {
  const summary = async (url: URL): Promise<LocalInferSummary> => {
    const engineParam = url.searchParams.get('engine')
    const configParam = url.searchParams.get('config')
    let config: Config | undefined
    if (configParam !== null) {
      try {
        config = JSON.parse(configParam) as Config
      } catch {
        config = undefined
      }
    }
    // exactOptionalPropertyTypes: build the request object with only the keys
    // that are present, so an absent value never writes `undefined`.
    const request: { engine?: string; config?: Config } = {}
    if (engineParam !== null) {
      request.engine = engineParam
    }
    if (config !== undefined) {
      request.config = config
    }
    return buildSummary(localInfer, request)
  }

  const route = {
    name: 'local-infer-config',
    kind: 'exact' as const,
    path: '/local-infer/summary',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method === 'GET') {
        try {
          send(200, await summary(new URL(req.url, 'http://localhost')))
        } catch (error) {
          send(500, { error: String((error as Error)?.message ?? error) })
        }
        return
      }
      res.writeHead(405).end()
    },
  }

  const save = {
    name: 'local-infer-save',
    kind: 'exact' as const,
    path: '/local-infer/save',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'config payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
          allowRunDeps?: unknown
          platform?: unknown
          showHelp?: unknown
          // The provider id to update. Absent means a new provider entry,
          // which the route mints an id for and prepends to the list.
          id?: unknown
          // The log-file location template the card's log-location field edits.
          // Absent keeps the stored template (or the plugin default).
          logPath?: unknown
        }
        const engine = typeof body.engine === 'string' ? body.engine : 'ninfer'
        const config = body.config && typeof body.config === 'object' ? (body.config as Config) : {}
        const allowRunDeps = typeof body.allowRunDeps === 'boolean' ? body.allowRunDeps : false
        const platform = parsePlatformConfigs(body.platform)
        // A body that predates the key keeps the descriptions visible.
        const showHelp = typeof body.showHelp === 'boolean' ? body.showHelp : true
        const providerId = typeof body.id === 'string' && body.id.trim() !== '' ? body.id : undefined
        // A body that omits the log location (or sends a blank one) keeps the
        // stored template, so an unsaved edit never wipes a custom path.
        const logPath =
          typeof body.logPath === 'string' && body.logPath !== ''
            ? body.logPath
            : readConfig().logPath
        // Save upserts a provider entry: an id updates the stored entry in
        // place, an absent id mints a new id and prepends the entry, so a Save
        // always adds (or refreshes) a card entry at the top of the list. The
        // provider's platform config is the per-engine entry the deploy step
        // reads, so a provider never carries a field it cannot price.
        const stored = readConfig()
        const provider: StoredProviderConfig = {
          id: providerId ?? newProviderId(),
          engine,
          config,
          platform: platform[engine] ?? {},
        }
        const providers =
          providerId !== undefined
            ? stored.providers.map((entry) => (entry.id === providerId ? provider : entry))
            : [provider, ...stored.providers]
        writeConfig(engine, config, allowRunDeps, platform, showHelp, providers, logPath)
        // Re-sync the service registry with the saved platform map, so the next
        // launch reads the platform config the user just saved.
        syncPlatformConfigs(localInfer, {
          engine,
          config,
          allowRunDeps,
          platform,
          showHelp,
          providers,
          logPath,
          lastLogs: stored.lastLogs,
        })
        send(200, await buildSummary(localInfer, { engine, config }))
      } catch (error) {
        send(400, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const deleteProvider = {
    name: 'local-infer-provider-delete',
    kind: 'exact' as const,
    path: '/local-infer/provider-delete',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: unknown }
        const id = typeof body.id === 'string' ? body.id : undefined
        if (id === undefined) {
          send(400, { error: 'the provider id is required' })
          return
        }
        // Delete removes the stored provider entry by id, keeping the rest of
        // the list and the active config intact, then re-syncs the registry so
        // a launch never reads a platform config the user just removed.
        const stored = readConfig()
        const providers = stored.providers.filter((entry) => entry.id !== id)
        writeConfig(
          stored.engine,
          stored.config,
          stored.allowRunDeps,
          stored.platform,
          stored.showHelp,
          providers,
          stored.logPath,
          stored.lastLogs,
        )
        syncPlatformConfigs(localInfer, stored)
        send(200, await buildSummary(localInfer))
      } catch (error) {
        send(400, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const deps = {
    name: 'local-infer-deps',
    kind: 'exact' as const,
    path: '/local-infer/deps',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      const url = new URL(req.url, 'http://localhost')
      const engineParam = url.searchParams.get('engine')
      const configParam = url.searchParams.get('config')
      let config: Config | undefined
      if (configParam !== null) {
        try {
          config = JSON.parse(configParam) as Config
        } catch {
          config = undefined
        }
      }
      // exactOptionalPropertyTypes: build the request object with only the
      // keys that are present, so an absent value never writes `undefined`.
      const request: DepsRequest = {}
      if (engineParam !== null) {
        request.engine = engineParam
      }
      if (config !== undefined) {
        request.config = config
      }
      try {
        send(200, await buildDeps(localInfer, request))
      } catch (error) {
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const install = {
    name: 'local-infer-install',
    kind: 'exact' as const,
    path: '/local-infer/install',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'install payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
        }
        const request: DepsRequest = {}
        if (typeof body.engine === 'string') {
          request.engine = body.engine
        }
        if (body.config && typeof body.config === 'object') {
          request.config = body.config as Config
        }
        send(200, await runInstallFor(localInfer, request))
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const download = {
    name: 'local-infer-download',
    kind: 'exact' as const,
    path: '/local-infer/download',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'download payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          model?: unknown
          directory?: unknown
        }
        const request: DownloadRequest = {}
        if (typeof body.engine === 'string') {
          request.engine = body.engine
        }
        if (typeof body.model === 'string') {
          request.model = body.model
        }
        if (typeof body.directory === 'string') {
          request.directory = body.directory
        }
        send(200, await downloadFor(localInfer, request))
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  // The launch and stop routes share a POST body parser: the engine, config,
  // and platform override the plan renders from, falling back to the stored
  // config per key. The stop route ignores the platform key.
  const launchRequestFromBody = (body: {
    engine?: unknown
    config?: unknown
    platform?: unknown
  }): LaunchRequest => {
    const request: LaunchRequest = {}
    if (typeof body.engine === 'string') {
      request.engine = body.engine
    }
    if (body.config && typeof body.config === 'object') {
      request.config = body.config as Config
    }
    const platform = parseStoredPlatformConfig(body.platform)
    if (platform !== undefined) {
      request.platform = platform
    }
    return request
  }

  const launch = {
    name: 'local-infer-launch',
    kind: 'exact' as const,
    path: '/local-infer/launch',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'launch payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
        }
        send(200, await launchEngine(localInfer, launchRequestFromBody(body)))
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const stop = {
    name: 'local-infer-stop',
    kind: 'exact' as const,
    path: '/local-infer/stop',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'stop payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
        }
        await stopEngine(localInfer, launchRequestFromBody(body))
        send(200, { stopped: true })
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  // The register and unregister routes share a body parser: the engine and
  // config the plan renders from, plus agentDefault for the register route,
  // falling back to the stored config per key.
  const registerRequestFromBody = (body: {
    engine?: unknown
    config?: unknown
    agentDefault?: unknown
  }): RegisterRequest => {
    const request: RegisterRequest = {}
    if (typeof body.engine === 'string') {
      request.engine = body.engine
    }
    if (body.config && typeof body.config === 'object') {
      request.config = body.config as Config
    }
    if (typeof body.agentDefault === 'boolean') {
      request.agentDefault = body.agentDefault
    }
    return request
  }

  const register = {
    name: 'local-infer-register',
    kind: 'exact' as const,
    path: '/local-infer/register',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'register payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
          agentDefault?: unknown
        }
        send(200, await registerFor(localInfer, registerRequestFromBody(body)))
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  const unregister = {
    name: 'local-infer-unregister',
    kind: 'exact' as const,
    path: '/local-infer/unregister',
    handler: async (req: IncomingLike, res: OutgoingLike) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > 64 * 1024) {
            send(413, { error: 'unregister payload too large' })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          engine?: unknown
          config?: unknown
        }
        send(200, await unregisterFor(localInfer, registerRequestFromBody(body)))
      } catch (error) {
        if (error instanceof RouteError) {
          send(error.status, { error: error.message })
          return
        }
        send(500, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  scope.effect(
    () => {
      // Sync the service's platform-config registry with the stored config on
      // route registration, so a launch before the first save reads the
      // platform config the user last saved.
      syncPlatformConfigs(localInfer, readConfig())
      const disposeSummary = scope.webServer.register(route)
      const disposeSave = scope.webServer.register(save)
      const disposeDeleteProvider = scope.webServer.register(deleteProvider)
      const disposeDeps = scope.webServer.register(deps)
      const disposeInstall = scope.webServer.register(install)
      const disposeDownload = scope.webServer.register(download)
      const disposeLaunch = scope.webServer.register(launch)
      const disposeStop = scope.webServer.register(stop)
      const disposeRegister = scope.webServer.register(register)
      const disposeUnregister = scope.webServer.register(unregister)
      return () => {
        disposeSummary()
        disposeSave()
        disposeDeleteProvider()
        disposeDeps()
        disposeInstall()
        disposeDownload()
        disposeLaunch()
        disposeStop()
        disposeRegister()
        disposeUnregister()
      }
    },
    'local-infer: settings routes',
  )
}
