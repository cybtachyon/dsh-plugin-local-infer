/**
 * The webServer route the Web card talks to. GET /local-infer/summary returns
 * the engine list, the detected hardware, the form model for the selected
 * engine, and the VRAM meter model for the current config; POST /local-infer/
 * save persists the config. The values live in ~/.dsh/local-infer/config.json,
 * shared with the CLI, so the browser never sees a secret it did not store.
 * The route is held by an effect, so it goes when the plugin does.
 * @module @dsh/dsh-plugin-local-infer/ui/route
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Config, HardwareProfile, VramVerdict } from '@dsh/dsh-plugin-local-infer/core'
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
// Relative, not the root package subpath: a self-referencing bare specifier
// only resolves when the package sits inside a node_modules tree, so a
// local-path or pnpm-linked install of this repo would fail the import.
import { ENGINES } from '../../providers/lib/index.js'
import { renderForm } from './form.ts'
import type { FormModel } from './form.ts'
import { renderMeter } from './meter.ts'
import type { MeterModel } from './meter.ts'

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
 * meter model for the current config, the verdict the banner renders, and the
 * config the form edits. Every field is plain data, so it crosses the socket
 * without a function left behind.
 */
export interface LocalInferSummary {
  engines: { id: string; label: string; supports: { docker: boolean; local: boolean } }[]
  models: { id: string; source: string }[]
  hardware: HardwareProfile
  engineId: string
  formModel: FormModel
  meterModel: MeterModel
  verdict: VramVerdict
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
}

/**
 * readConfig reads the stored engine and config. A missing or broken file reads
 * as the scaffold default (NInfer, empty config) so the card always has a form
 * to draw.
 */
export function readConfig(): StoredConfig {
  const path = localInferConfigPath()
  if (!existsSync(path)) {
    return { engine: 'ninfer', config: {} }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { engine?: unknown; config?: unknown }
    return {
      engine: typeof parsed.engine === 'string' ? parsed.engine : 'ninfer',
      config: parsed.config && typeof parsed.config === 'object' ? (parsed.config as Config) : {},
    }
  } catch {
    return { engine: 'ninfer', config: {} }
  }
}

/**
 * writeConfig persists the engine and config, creating the directory tree on
 * first write.
 */
export function writeConfig(engine: string, config: Config): void {
  const path = localInferConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ engine, config }, null, 2))
}

/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, and the meter model the
 * service's estimate prices. The estimate is the single source the meter and
 * the banner agree on.
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
    config,
  }
}

/**
 * registerLocalInferRoute registers the summary and save routes on the web
 * server and holds them by an effect, so a bundle switch off removes them
 * before the next switch on re-registers. The scoped context carries the
 * webServer; the localInfer service is passed in because the scope only
 * injects what it names.
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
        }
        const engine = typeof body.engine === 'string' ? body.engine : 'ninfer'
        const config = body.config && typeof body.config === 'object' ? (body.config as Config) : {}
        writeConfig(engine, config)
        send(200, await buildSummary(localInfer, { engine, config }))
      } catch (error) {
        send(400, { error: String((error as Error)?.message ?? error) })
      }
    },
  }

  scope.effect(
    () => {
      const disposeSummary = scope.webServer.register(route)
      const disposeSave = scope.webServer.register(save)
      return () => {
        disposeSummary()
        disposeSave()
      }
    },
    'local-infer: settings routes',
  )
}
