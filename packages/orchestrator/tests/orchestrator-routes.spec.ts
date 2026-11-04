/**
 * The Orchestrator settings routes tests: the routes register when a
 * webServer seam is present and are skipped silently when absent, and the
 * handlers answer over the fake req/res harness adapted from
 * packages/ui/tests/route.spec.ts (method guard, save-to-get round trip,
 * blank-prompt clearing, the validation and body-size rejections, and the
 * non-404 probe answer the client mount check relies on). os.homedir() keys
 * the saved prompt file, so each test points HOME at a scratch dir and never
 * touches the real one.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const promptPath = join(packageRoot, 'prompt.md')

/** One route the fake webServer recorded. */
interface RegisteredRoute {
  name: string
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => Promise<void>
}

function fakeRes() {
  const res = {
    status: 0,
    body: '',
    writeHead(status: number): typeof res {
      res.status = status
      return res
    },
    end(body?: string): typeof res {
      if (body !== undefined) {
        res.body = body
      }
      return res
    },
  }
  return res
}

function fakeReq(method: string, url: string, body?: string) {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  const req = {
    method,
    url,
    destroyed: false,
    destroy(): void {
      // The handler only destroys on an oversize body; the test reads the flag.
      req.destroyed = true
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
  return req
}

/**
 * mountRoutes applies a fresh copy of the plugin on a context whose fake
 * inject offers the webServer seam only when asked, and (when offered)
 * records the routes its register receives plus the effect disposer. The
 * systemPrompt seam is never offered: these specs price the route half only.
 */
async function mountRoutes(
  options: { offerWebServer?: boolean; throwOnRegister?: boolean } = {},
): Promise<{
  mod: typeof import('../src/index.ts')
  routes: RegisteredRoute[]
  dispose: () => void
}> {
  vi.resetModules()
  const mod = await import('../src/index.ts')
  const routes: RegisteredRoute[] = []
  let disposeEffect: (() => void) | undefined
  const scope = {
    webServer: {
      register(route: RegisteredRoute): () => void {
        if (options.throwOnRegister === true) {
          throw new Error('webServer refuses the route')
        }
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) {
            routes.splice(index, 1)
          }
        }
      },
    },
    effect(fn: () => unknown): void {
      disposeEffect = fn() as () => void
    },
  }
  const ctx = new Context()
  ;(
    ctx as unknown as { inject: (names: string[], cb: (scope: unknown) => void) => void }
  ).inject = (names, cb) => {
    if (names[0] === 'webServer' && options.offerWebServer !== false) {
      cb(scope)
    }
  }
  mod.apply(ctx)
  return { mod, routes, dispose: () => disposeEffect?.() }
}

function routeByPath(routes: RegisteredRoute[], path: string): RegisteredRoute {
  const route = routes.find((entry) => entry.path === path)
  if (route === undefined) {
    throw new Error(`no route registered at ${path}`)
  }
  return route
}

let home: string

beforeEach(() => {
  // The prompt store keys the saved file on homedir(); HOME covers POSIX and
  // USERPROFILE covers Windows.
  home = mkdtempSync(join(tmpdir(), 'orchestrator-routes-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('orchestrator settings routes', () => {
  it('registers both routes when the webServer seam is present', async () => {
    const { routes } = await mountRoutes()
    expect(routes.map((route) => [route.name, route.kind, route.path])).toEqual([
      ['local-infer-orchestrator', 'exact', '/local-infer/orchestrator'],
      ['local-infer-orchestrator-save', 'exact', '/local-infer/orchestrator/save'],
    ])
  })

  it('skips route registration silently when the seam never arrives', async () => {
    const { routes } = await mountRoutes({ offerWebServer: false })
    expect(routes).toEqual([])
  })

  it('swallows a webServer registration failure so the component still loads', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      /* the inject catch logs and continues */
    })
    const { routes } = await mountRoutes({ throwOnRegister: true })
    expect(routes).toEqual([])
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('orchestrator settings routes skipped'),
    )
    error.mockRestore()
  })

  it('unregisters both routes when the effect disposes', async () => {
    const { routes, dispose } = await mountRoutes()
    expect(routes.length).toBe(2)
    dispose()
    expect(routes).toEqual([])
  })

  it('answers 405 for the wrong method on both routes', async () => {
    const { routes } = await mountRoutes()
    const getRes = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator').handler(
      fakeReq('POST', '/local-infer/orchestrator', '{}'),
      getRes,
    )
    expect(getRes.status).toBe(405)
    const saveRes = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator/save').handler(
      fakeReq('GET', '/local-infer/orchestrator/save'),
      saveRes,
    )
    expect(saveRes.status).toBe(405)
  })

  it('answers the GET with the default prompt and saved false before any save', async () => {
    const { routes } = await mountRoutes()
    const res = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator').handler(
      fakeReq('GET', '/local-infer/orchestrator'),
      res,
    )
    // Any non-404 answer is proof the route exists: the client's mount probe
    // reads this 200 before the first save.
    expect(res.status).toBe(200)
    const defaultPrompt = readFileSync(promptPath, 'utf8')
    expect(JSON.parse(res.body)).toEqual({
      prompt: defaultPrompt,
      defaultPrompt,
      saved: false,
    })
  })

  it('round-trips a saved prompt through save into the get', async () => {
    const { mod, routes } = await mountRoutes()
    const saveRes = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator/save').handler(
      fakeReq('POST', '/local-infer/orchestrator/save', JSON.stringify({ prompt: 'my orchestrator prompt' })),
      saveRes,
    )
    expect(saveRes.status).toBe(200)
    const defaultPrompt = readFileSync(promptPath, 'utf8')
    expect(JSON.parse(saveRes.body)).toEqual({
      prompt: 'my orchestrator prompt',
      defaultPrompt,
      saved: true,
    })
    const getRes = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator').handler(
      fakeReq('GET', '/local-infer/orchestrator'),
      getRes,
    )
    expect(JSON.parse(getRes.body)).toEqual({
      prompt: 'my orchestrator prompt',
      defaultPrompt,
      saved: true,
    })
    // The save went through the config setter, so the system-prompt section
    // reads the same holder the routes refreshed.
    expect(mod.getOrchestratorPrompt()).toBe('my orchestrator prompt')
  })

  it('clears the saved override back to the default on a blank save', async () => {
    const { routes } = await mountRoutes()
    const saveRoute = routeByPath(routes, '/local-infer/orchestrator/save')
    await saveRoute.handler(
      fakeReq('POST', '/local-infer/orchestrator/save', JSON.stringify({ prompt: 'a saved prompt' })),
      fakeRes(),
    )
    const res = fakeRes()
    await saveRoute.handler(
      fakeReq('POST', '/local-infer/orchestrator/save', JSON.stringify({ prompt: '' })),
      res,
    )
    expect(res.status).toBe(200)
    const defaultPrompt = readFileSync(promptPath, 'utf8')
    expect(JSON.parse(res.body)).toEqual({
      prompt: defaultPrompt,
      defaultPrompt,
      saved: false,
    })
  })

  it('rejects a non-string prompt with 400', async () => {
    const { routes } = await mountRoutes()
    const res = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator/save').handler(
      fakeReq('POST', '/local-infer/orchestrator/save', JSON.stringify({ prompt: 7 })),
      res,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('prompt must be a string')
  })

  it('rejects an unparseable save body with the fail status', async () => {
    const { routes } = await mountRoutes()
    const res = fakeRes()
    await routeByPath(routes, '/local-infer/orchestrator/save').handler(
      fakeReq('POST', '/local-infer/orchestrator/save', '{broken'),
      res,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('JSON')
  })

  it('rejects an oversized save body with 413 and destroys the request', async () => {
    const { routes } = await mountRoutes()
    const res = fakeRes()
    const req = fakeReq(
      'POST',
      '/local-infer/orchestrator/save',
      JSON.stringify({ prompt: 'x'.repeat(70 * 1024) }),
    )
    await routeByPath(routes, '/local-infer/orchestrator/save').handler(req, res)
    expect(res.status).toBe(413)
    expect(JSON.parse(res.body).error).toContain('too large')
    expect(req.destroyed).toBe(true)
  })
})
