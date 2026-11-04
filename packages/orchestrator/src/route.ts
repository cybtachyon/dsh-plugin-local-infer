/**
 * The Orchestrator settings routes the Web card talks to: GET
 * /local-infer/orchestrator answers { prompt, defaultPrompt, saved } (the
 * effective prompt, the shipped prompt.md default, and whether the effective
 * prompt is a saved value), and POST /local-infer/orchestrator/save persists
 * { prompt } through the config setter (an empty string clears the saved
 * override back to the default) and answers with the same payload. The routes
 * are held by an effect, so they go when the component does.
 *
 * The HTTP plumbing is a minimal local mirror of the ui package's defineRoute
 * template (method guard 405, bounded body 413, JSON answer). The ui package
 * does export its template, but this package deliberately keeps no dependency
 * on ui: importing ui's route module would load its whole route graph (the
 * service, providers, and core packages) into a component that ships disabled
 * and must stay loadable headless, so the shared shape is copied rather than
 * imported, and the two copies change together by hand. The stream helpers
 * the ui template carries are dropped; these two routes only ever answer with
 * one JSON body.
 * @module dsh-plugin-local-infer/orchestrator/route
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defaultOrchestratorPrompt,
  getOrchestratorPrompt,
  hasSavedOrchestratorPrompt,
  setOrchestratorPrompt,
} from './config.js'

/**
 * OrchestratorRoute is one webServer route definition the register step holds
 * by an effect: the stable name, the exact-match path, and the handler the web
 * server invokes per request.
 */
export interface OrchestratorRoute {
  name: string
  kind: 'exact'
  path: string
  handler: (req: IncomingLike, res: OutgoingLike) => void | Promise<void>
}

/**
 * The webServer service is dsh-specific and absent from the cordis Context
 * type, so the route narrows the scoped context to the one member it needs
 * (same shape as the ui's WebServerService narrowing).
 */
export interface WebServerService {
  register(route: OrchestratorRoute): () => void
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
 * RouteError is a route failure that carries its own HTTP status, so a
 * handler can answer a validation rejection with its own code instead of the
 * spec's failStatus.
 */
class RouteError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RouteError'
    this.status = status
  }
}

/**
 * The request body size cap the save route enforces: a prompt is a few
 * kilobytes at most, so a body past 64 KiB is a client bug, not a prompt.
 * Deliberately mirrors the cap in packages/ui/src/route.ts (ui is not a
 * dependency here): one malformed client misbehaves the same on every
 * /local-infer route, so edit the two together.
 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * readJsonBody collects a bounded JSON request body: chunks up to the cap,
 * then parses. A body past the cap destroys the request and throws a 413
 * RouteError carrying the route's own message, so the answer names the route
 * that rejected the body.
 */
async function readJsonBody(
  req: IncomingLike,
  tooLargeMessage: string,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new RouteError(413, tooLargeMessage)
    }
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

/** Writes one JSON answer (status head plus body) on the response. */
function writeJson(res: OutgoingLike, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * RouteInput is what a route handler receives: the parsed URL and, for the
 * POST route, the bounded JSON body.
 */
interface RouteInput {
  url: URL
  body: Record<string, unknown>
}

/**
 * RouteSpec is a route definition: the stable name, the exact-match path, the
 * method guard, the status an unexpected handler failure answers with, and
 * the handler. The object literal union keeps the invariant the guard
 * enforces: only a POST spec carries a 413 message, because only a POST spec
 * reads a body.
 */
type RouteSpec =
  | {
      name: string
      path: string
      method: 'GET'
      failStatus: number
      run(input: RouteInput, json: (status: number, body: unknown) => void): Promise<void>
    }
  | {
      name: string
      path: string
      method: 'POST'
      failStatus: number
      tooLargeMessage: string
      run(input: RouteInput, json: (status: number, body: unknown) => void): Promise<void>
    }

/**
 * defineRoute is the local template both route specs build on: it guards the
 * method (405), reads the bounded body (413, POST only), and maps the
 * handler's answer to a status: a RouteError carries its own status, any
 * other failure answers with the spec's failStatus.
 */
function defineRoute(spec: RouteSpec): OrchestratorRoute {
  return {
    name: spec.name,
    kind: 'exact',
    path: spec.path,
    handler: async (req, res) => {
      if (req.method !== spec.method) {
        res.writeHead(405).end()
        return
      }
      try {
        const body =
          spec.method === 'POST' ? await readJsonBody(req, spec.tooLargeMessage) : {}
        await spec.run({ url: new URL(req.url, 'http://localhost'), body }, (status, answer) =>
          writeJson(res, status, answer),
        )
      } catch (error) {
        if (error instanceof RouteError) {
          writeJson(res, error.status, { error: error.message })
          return
        }
        writeJson(res, spec.failStatus, { error: String((error as Error)?.message ?? error) })
      }
    },
  }
}

/**
 * OrchestratorPayload is the answer body both routes share: the effective
 * prompt, the shipped prompt.md default, and whether the effective prompt is
 * a saved value. The saved flag reads the file, so a by-hand edit shows up on
 * the next GET without a host restart.
 */
interface OrchestratorPayload {
  prompt: string
  defaultPrompt: string
  saved: boolean
}

function orchestratorPayload(): OrchestratorPayload {
  return {
    prompt: getOrchestratorPrompt(),
    defaultPrompt: defaultOrchestratorPrompt(),
    saved: hasSavedOrchestratorPrompt(),
  }
}

/**
 * orchestratorGetRoute builds the GET /local-infer/orchestrator route. The
 * client treats any non-404 answer as proof the route is mounted, so the
 * payload answers 200 even before anything is saved.
 */
function orchestratorGetRoute(): OrchestratorRoute {
  return defineRoute({
    name: 'local-infer-orchestrator',
    path: '/local-infer/orchestrator',
    method: 'GET',
    failStatus: 500,
    run: async (_input, json) => {
      json(200, orchestratorPayload())
    },
  })
}

/**
 * orchestratorSaveRoute builds the POST /local-infer/orchestrator/save route:
 * a string prompt persists through setOrchestratorPrompt (an empty string
 * clears the saved override back to the default) and the answer carries the
 * GET payload shape so the card re-renders from one response.
 */
function orchestratorSaveRoute(): OrchestratorRoute {
  return defineRoute({
    name: 'local-infer-orchestrator-save',
    path: '/local-infer/orchestrator/save',
    method: 'POST',
    failStatus: 400,
    tooLargeMessage: 'orchestrator prompt payload too large',
    run: async ({ body }, json) => {
      if (typeof body.prompt !== 'string') {
        throw new RouteError(400, 'prompt must be a string')
      }
      setOrchestratorPrompt(body.prompt)
      json(200, orchestratorPayload())
    },
  })
}

/**
 * registerOrchestratorRoutes registers the GET and save routes on the web
 * server and holds them by an effect, so a component switch off removes them
 * before the next switch on re-registers. The scoped context carries the
 * webServer.
 */
export function registerOrchestratorRoutes(
  scope: Context & { webServer: WebServerService },
): void {
  const routes: OrchestratorRoute[] = [orchestratorGetRoute(), orchestratorSaveRoute()]
  scope.effect(
    () => {
      const disposers = routes.map((route) => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) {
          dispose()
        }
      }
    },
    'local-infer-orchestrator: settings routes',
  )
}
