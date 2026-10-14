/**
 * The webServer route the Web card talks to. GET /local-infer/summary returns
 * the engine list, the detected hardware, the form model for the selected
 * engine, the VRAM meter model for the current config, and the guideline
 * warning model the banner and inline red warnings render from; POST
 * /local-infer/save persists the config. The values live in
 * ~/.dsh/local-infer/config.json, shared with the CLI, so the browser never
 * sees a secret it did not store. The route is held by an effect, so it goes
 * when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Config,
  HardwareProfile,
  InstallResult,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { checkDeps, renderInstallString } from '../../core/lib/index.js'
import { ENGINES } from '../../providers/lib/index.js'
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
}

/**
 * The config file the route owns. It sits under the dsh home so a web user and
 * a CLI user share one file, the way modsearch shares ~/.modsearch.
 */
export function localInferConfigPath(): string {
  return join(homedir(), '.dsh', 'local-infer', 'config.json')
}

export interface StoredConfig {
  engine: string
  config: Config
  // The Play/Run trust gate (the plan's allowRunDeps): one-click install runs
  // package-manager commands, often as root, so it stays off until the user
  // says the add-on may.
  allowRunDeps: boolean
}

/**
 * readConfig reads the stored engine, config, and the allowRunDeps trust gate.
 * A missing or broken file reads as the scaffold default (NInfer, empty
 * config, gate off) so the card always has a form to draw.
 */
export function readConfig(): StoredConfig {
  const path = localInferConfigPath()
  if (!existsSync(path)) {
    return { engine: 'ninfer', config: {}, allowRunDeps: false }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      engine?: unknown
      config?: unknown
      allowRunDeps?: unknown
    }
    return {
      engine: typeof parsed.engine === 'string' ? parsed.engine : 'ninfer',
      config: parsed.config && typeof parsed.config === 'object' ? (parsed.config as Config) : {},
      allowRunDeps: typeof parsed.allowRunDeps === 'boolean' ? parsed.allowRunDeps : false,
    }
  } catch {
    return { engine: 'ninfer', config: {}, allowRunDeps: false }
  }
}

/**
 * writeConfig persists the engine, config, and trust gate, creating the
 * directory tree on first write.
 */
export function writeConfig(engine: string, config: Config, allowRunDeps: boolean): void {
  const path = localInferConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ engine, config, allowRunDeps }, null, 2))
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
  const config = request?.config ?? stored.config
  // ENGINES is a known non-empty constant, so the fallback is always defined.
  const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0]!
  const hardware = await localInfer.detectHardware()
  const estimate = await localInfer.estimate(config, hardware)
  const guidelineResults = await localInfer.guidelines(config, hardware)
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
    ),
    verdict: estimate.verdict,
    warningsModel: renderWarnings(guidelineResults),
    config,
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
 * registerLocalInferRoute registers the summary, save, deps, and install
 * routes on the web server and holds them by an effect, so a bundle switch
 * off removes them before the next switch on re-registers. The scoped context
 * carries the webServer; the localInfer service is passed in because the
 * scope only injects what it names.
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
        }
        const engine = typeof body.engine === 'string' ? body.engine : 'ninfer'
        const config = body.config && typeof body.config === 'object' ? (body.config as Config) : {}
        const allowRunDeps = typeof body.allowRunDeps === 'boolean' ? body.allowRunDeps : false
        writeConfig(engine, config, allowRunDeps)
        send(200, await buildSummary(localInfer, { engine, config }))
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

  scope.effect(
    () => {
      const disposeSummary = scope.webServer.register(route)
      const disposeSave = scope.webServer.register(save)
      const disposeDeps = scope.webServer.register(deps)
      const disposeInstall = scope.webServer.register(install)
      return () => {
        disposeSummary()
        disposeSave()
        disposeDeps()
        disposeInstall()
      }
    },
    'local-infer: settings routes',
  )
}
