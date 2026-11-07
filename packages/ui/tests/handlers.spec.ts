/**
 * The route handlers over a fake web server (the registered route table,
 * summary/save/deps/install/download/chat-template/get/launch/stop/logs
 * round trips, NDJSON streams) and the route handler error branches (405,
 * 404, 413, 500). (Split from route.spec.ts by describe, TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DefaultModel, LaunchPlan, LifecycleHost } from 'dsh-plugin-local-infer/core'
import { SUDO_CLI_NOTE } from 'dsh-plugin-local-infer/core'
import type { DownloadModelOptions, DownloadResult, LaunchResult, LocalInferService } from 'dsh-plugin-local-infer/service'
import { readConfig, writeConfig } from '../src/config.ts'
import { CANCELED_LINE } from '../src/ops/engine.ts'
import { registerLocalInferRoute, RouteError } from '../src/route.ts'
import { EXPECTED_ROUTE_PATHS, wrongMethodFor } from './route-paths.ts'
import { MODEL_DIR, TEST_DEP, fakeAdapter, pointHomeAt, stubGetHost, stubService } from './fixtures.ts'

describe('route handlers over a fake web server', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-http-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  interface FakeRes {
    status: number
    body: string
    closeListeners: Array<() => void>
  }

  function fakeRes(): FakeRes {
    const res = {
      status: 0,
      body: '',
      closeListeners: [] as Array<() => void>,
      writeHead(status: number): FakeRes {
        res.status = status
        return res
      },
      // The streaming routes (the launch NDJSON) write lines as they land; the
      // fake accumulates them so the test reads the full stream.
      write(chunk: string): FakeRes {
        res.body += chunk
        return res
      },
      end(body?: string): FakeRes {
        // A streamed body (the launch NDJSON) is already accumulated; a plain
        // end body replaces it.
        res.body = body !== undefined ? body : res.body
        return res
      },
      // The stream routes watch the response's client disconnect (the node
      // 'close' before the route ends); the fake captures the listener so a
      // test simulates the card's Cancel closing the stream.
      on(event: string, listener: (...args: unknown[]) => void): FakeRes {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  function fakeReq(method: string, url: string, body?: string) {
    const chunks = body !== undefined ? [Buffer.from(body)] : []
    return {
      method,
      url,
      destroy(): void {
        /* the handlers only destroy on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        for (const chunk of chunks) {
          yield chunk
        }
      },
    }
  }

  function registeredRoutes(service: LocalInferService, launchHost?: LifecycleHost) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }): () => void {
          routes.push(route)
          return () => {
            /* the effect disposer unregisters; the test owns the list */
          }
        },
      },
      effect(fn: () => unknown): void {
        fn()
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
      undefined,
      launchHost,
    )
    return routes
  }

  it('serves the deps route and maps the install route through the gate', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const routes = registeredRoutes(stubService([], { deps: [TEST_DEP] }))
    const paths = routes.map((route) => route.path)
    expect(paths).toEqual(EXPECTED_ROUTE_PATHS)

    const depsRoute = routes.find((route) => route.path === '/local-infer/deps')
    const depsRes = fakeRes()
    await depsRoute?.handler(fakeReq('GET', '/local-infer/deps?engine=ninfer'), depsRes)
    expect(depsRes.status).toBe(200)
    const depsModel = JSON.parse(depsRes.body)
    expect(depsModel.deps[0]?.id).toBe('cmake')
    expect(depsModel.allSatisfied).toBe(false)
    expect(depsModel.runAllowed).toBe(false)

    // The gate is off, so the install route answers 409 with its message.
    const installRoute = routes.find((route) => route.path === '/local-infer/install')
    const installRes = fakeRes()
    await installRoute?.handler(
      fakeReq('POST', '/local-infer/install', JSON.stringify({ engine: 'ninfer' })),
      installRes,
    )
    expect(installRes.status).toBe(409)
    expect(JSON.parse(installRes.body).error).toContain('not allowed')
  })

  it('runs the install route through to a refreshed deps model when the gate is on', async () => {
    writeConfig('ninfer', {}, true)
    const routes = registeredRoutes(stubService([], { deps: [TEST_DEP] }))
    const installRoute = routes.find((route) => route.path === '/local-infer/install')
    const res = fakeRes()
    await installRoute?.handler(
      fakeReq('POST', '/local-infer/install', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.result.ok).toBe(true)
    expect(body.deps.allSatisfied).toBe(true)
  })

  it('serves the register and unregister routes through to the service', async () => {
    let removed: { providerId: string; modelId: string } | undefined
    const service = stubService(
      [],
      {
        engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
        onRemove: (args) => {
          removed = args
        },
      },
    )
    const routes = registeredRoutes(service)

    const registerRoute = routes.find((route) => route.path === '/local-infer/register')
    const registerRes = fakeRes()
    await registerRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/register',
        JSON.stringify({ engine: 'ninfer', config: { maxContext: 32768 }, agentDefault: true }),
      ),
      registerRes,
    )
    expect(registerRes.status).toBe(200)
    const registerBody = JSON.parse(registerRes.body)
    expect(registerBody.ok).toBe(true)
    expect(registerBody.entry.modelId).toBe('Qwen3.8-27B')
    expect(registerBody.entry.baseURL).toBe('http://127.0.0.1:18020/v1')

    const unregisterRoute = routes.find((route) => route.path === '/local-infer/unregister')
    const unregisterRes = fakeRes()
    await unregisterRoute?.handler(
      fakeReq('POST', '/local-infer/unregister', JSON.stringify({ engine: 'ninfer' })),
      unregisterRes,
    )
    expect(unregisterRes.status).toBe(200)
    expect(JSON.parse(unregisterRes.body)).toEqual({ removed: true })
    expect(removed).toEqual({ providerId: 'ninfer-local-qwen38-27b', modelId: 'Qwen3.8-27B' })
  })

  it('answers 405 for the wrong method on every route', async () => {
    const routes = registeredRoutes(stubService([]))
    expect(routes.map((route) => route.path)).toEqual(EXPECTED_ROUTE_PATHS)
    for (const route of routes) {
      const res = fakeRes()
      // Each route takes one method; the wrong one is its complement, read
      // from the shared route table (the GET routes take a POST, the POST
      // routes a GET).
      const method = wrongMethodFor(route.path)
      await route.handler(
        method === 'POST' ? fakeReq('POST', route.path, '{}') : fakeReq('GET', route.path),
        res,
      )
      expect(res.status).toBe(405)
    }
  })

  it('streams the launch as NDJSON step events then a result event', async () => {
    // The trust gate is on, so the Get-steps dep install reports prereqs and
    // the sync/build step reports build as their work starts.
    writeConfig('ninfer', {}, true)
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stub service's launch reports the deploy sub-steps through the sink
    // the route threads, so the stream carries the full phase sequence the
    // card's button reads.
    service.launch = async (
      plan: LaunchPlan,
      options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void },
    ): Promise<LaunchResult> => {
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      options?.onProgress?.('launch')
      return { plan, healthy: true }
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    expect(res.status).toBe(200)
    // The stream is NDJSON: a step event as each phase's work begins (the
    // Get-steps phases in real order, then the deploy's), then a final result
    // event. The card's button reads the step that is running.
    const lines = res.body.split('\n').filter((line) => line !== '')
    const events = lines.map((line) => JSON.parse(line))
    expect(events.map((event) => (event.step !== undefined ? event.step : 'result'))).toEqual([
      'prereqs',
      'build',
      'download',
      'build',
      'launch',
      'result',
    ])
    expect(events[events.length - 1].result.healthy).toBe(true)
  })

  it('settles a launch that breaks before a plan renders to a result event (RouteError)', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    // A card that names an engine no adapter serves: the RouteError the
    // plan render throws still lands as a result event (the card's control
    // settles to the red Logs), not a bare 500 on an opened NDJSON stream.
    const service = stubService([])
    const routes = registeredRoutes(service, stubGetHost().host)
    const launch = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launch?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ghost' })),
      res,
    )
    const lines = res.body.split('\n').filter((line) => line !== '')
    const events = lines.map((line) => JSON.parse(line))
    expect(events).toEqual([
      { result: { healthy: false, detail: 'no engine adapter is registered for "ghost"' } },
    ])
  })

  it('settles a non-RouteError launch failure to a result event naming the detail', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    // A hardware probe failure (no plan, no RouteError) still settles the
    // card: the catch reads the Error's message into the result detail.
    const service = stubService([])
    service.detectHardware = async () => {
      throw new Error('gpu probe exploded')
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launch = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launch?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    const lines = res.body.split('\n').filter((line) => line !== '')
    const events = lines.map((line) => JSON.parse(line))
    expect(events).toEqual([
      { result: { healthy: false, detail: 'gpu probe exploded' } },
    ])
    // A host that throws a non-Error (a bare string) names the thrown value
    // itself: the catch's `?? error` fallback keeps the detail non-empty.
    service.detectHardware = async () => {
      throw 'gpu probe exploded'
    }
    const strRes = fakeRes()
    await launch?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      strRes,
    )
    const strEvents = strRes.body
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
    expect(strEvents).toEqual([
      { result: { healthy: false, detail: 'gpu probe exploded' } },
    ])
  })

  it('streams a sudo event and persists the CLI note when the host announces a waiting sudo', async () => {
    writeConfig('ninfer', {}, true)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    // The stub host plays the guarded node host: the body's sudo build
    // command is announced through the service's notify seam before it
    // runs, the way the real host announces after a credential probe that
    // found nothing cached.
    const host = stubGetHost({
      announceSudo: (command) => service.notifySudoNeeded(command),
    }).host
    const routes = registeredRoutes(service, host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({
          engine: 'ninfer',
          platform: { buildCommands: 'sudo ln -sf ./build/engine /usr/local/bin/engine' },
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const lines = res.body.split('\n').filter((line) => line !== '')
    // The sudo event is its own exact NDJSON line.
    expect(lines).toContain('{"sudo":true}')
    const kinds = lines
      .map((line) => JSON.parse(line))
      .map((event) =>
        event.step !== undefined
          ? event.step
          : event.progress !== undefined
            ? 'progress'
            : event.sudo === true
              ? 'sudo'
              : 'result',
      )
    // The prereqs and build phases land first (the dep install and the
    // sudo build command, reported by the Get steps as their work starts),
    // then the sudo event while the command is still waiting on the prompt,
    // then the result.
    expect(kinds).toEqual(['prereqs', 'build', 'sudo', 'result'])
    // The note line lands in the persisted last-run logs exactly once: the
    // run's log sink carries it into the composed run.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs).toContain(`${SUDO_CLI_NOTE}\n`)
    expect(lastLogs.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    // The note also reaches the live hub buffer the logs route streams,
    // under the draft launch's engine-id key.
    expect(service.readRunLog('ninfer').text).toContain(SUDO_CLI_NOTE)
    // The run registered its hook under the draft's key and cleared it when
    // it settled: one live hook at register, none at dispose.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('leaves no sudo observer registered after a failing launch run', async () => {
    writeConfig('ninfer', {}, false)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    service.launch = async (): Promise<LaunchResult> => {
      throw new Error('deploy exploded')
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer' })),
      res,
    )
    // The broken deploy still settles the stream with an unhealthy result.
    const events = res.body.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
    expect(events[events.length - 1].result.healthy).toBe(false)
    expect(events[events.length - 1].result.detail).toContain('deploy exploded')
    // The failed run unregistered its hook too, so a second launch never
    // announces through the dead run's stream writer.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('streams a progress event between the step and result events', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stubbed download invokes the injected onChunk with a tqdm line, the
    // way the real runner hands the hf download's streamed stderr to it.
    const tqdmLine = 'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n'
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { onChunk?: (chunk: string) => void }) => {
      options?.onChunk?.(tqdmLine)
      return Promise.resolve({ ok: true })
    }
    const routes = registeredRoutes(service, stubGetHost({ exists: false }).host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    await launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    // The stream carries the Get-steps step events in real order (prereqs,
    // build, download; the model download's step lands just before its
    // child), the progress event the download's tqdm chunk folded into, and
    // the result event, in order.
    const events = res.body.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
    const kinds = events.map((event) =>
      event.step !== undefined ? 'step' : event.progress !== undefined ? 'progress' : 'result',
    )
    expect(kinds).toEqual(['step', 'step', 'step', 'progress', 'result'])
    expect(events[2].step).toBe('download')
    expect(events[3].progress).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
    expect(events[events.length - 1].result.healthy).toBe(true)
  })

  it('reads the auto-rebuild flag from the launch body and threads it to the service', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    let seenAutoRebuild: boolean | undefined
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenAutoRebuild = options?.autoRebuild
      return { plan, healthy: true }
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    // The checkbox off in the card body: the flag lands on the service launch.
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', autoRebuild: false })),
      fakeRes(),
    )
    expect(seenAutoRebuild).toBe(false)
    // A body without the key (a non-boolean value reads as absent, too): the
    // deploy step runs the rebuild.
    seenAutoRebuild = undefined
    await launchRoute?.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', autoRebuild: 'no' })),
      fakeRes(),
    )
    expect(seenAutoRebuild).toBeUndefined()
  })

  it('aborts the in-flight launch download on a client disconnect and persists the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal: the
    // in-flight hf child the cancel interrupts.
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: { signal?: AbortSignal }) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost({ exists: false }).host)
    const launchRoute = routes.find((route) => route.path === '/local-infer/launch')
    const res = fakeRes()
    const pending = launchRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/launch',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    // Let the handler reach the hanging download, then the card's provider-form
    // Cancel closes the stream: the route aborts the in-flight download.
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    // The persisted run carries the "Canceled" line, so the Logs section and
    // the log file read the launch as canceled.
    expect(readConfig().lastLogs).toContain('--- Canceled')
  })

  it('aborts the in-flight model download on a client disconnect and marks the run canceled', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    const service = stubService([])
    // A download that hangs until the route's cancel aborts the signal: the
    // in-flight hf child the cancel interrupts, the launch route's rule.
    service.downloadModel = (_entry: DefaultModel, _directory: string, options?: DownloadModelOptions) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost().host)
    const downloadRoute = routes.find((route) => route.path === '/local-infer/download')
    const res = fakeRes()
    const pending = downloadRoute?.handler(
      fakeReq('POST', '/local-infer/download', JSON.stringify({ engine: 'ninfer', model: 'qwen3-27b' })),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    // The live run ends on the "Canceled" line and settles (running false):
    // the download card's Logs tail reads the cancel the launch reads.
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
    // The persisted section carries the seed, the failure, and the cancel.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('--- Canceled')
  })

  it('aborts the in-flight chat-template download on a client disconnect and marks the run canceled', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    const service = stubService([])
    service.downloadChatTemplate = (
      _repo: string,
      _directory: string,
      options?: DownloadModelOptions,
    ) =>
      new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    const routes = registeredRoutes(service, stubGetHost().host)
    const templateRoute = routes.find((route) => route.path === '/local-infer/chat-template')
    const res = fakeRes()
    const pending = templateRoute?.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({ engine: 'ninfer', template: 'neroued/Qwen3.8-27B/chat_template.jinja' }),
      ),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
  })

  it('stops the entry through the stop route and clears its launch record', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, true, undefined, true, [
      {
        id: 'stop-route',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 4242,
          startedAt: '2026-01-01T00:00:00.000Z',
          engineId: 'ninfer',
          argv: ['ninfer-serve'],
          previousPids: [],
        },
      },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([])
    service.stop = async (plan: LaunchPlan): Promise<void> => {
      stoppedPlan = plan
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const stopRoute = routes.find((route) => route.path === '/local-infer/stop')
    const res = fakeRes()
    await stopRoute?.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', providerId: 'stop-route' })),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ stopped: true })
    // The stop plan carries the record's pid, so a re-adopted engine's stop
    // signals the process the host did not spawn.
    expect(stoppedPlan?.pid).toBe(4242)
    // The cleared record is gone from the file, so a recycled pid cannot
    // re-link the engine the user just stopped.
    const entry = readConfig().providers.find((provider) => provider.id === 'stop-route')
    expect(entry?.launch).toBeUndefined()
  })

  it("answers 500 and persists the note when the stop route's stop fails", async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, true, undefined, true, [
      { id: 'stop-fail', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    service.stop = async (): Promise<void> => {
      throw new Error('container still running')
    }
    const routes = registeredRoutes(service, stubGetHost().host)
    const stopRoute = routes.find((route) => route.path === '/local-infer/stop')
    const res = fakeRes()
    await stopRoute?.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', providerId: 'stop-fail' })),
      res,
    )
    // The failure answers 500 so the card's stop deadline settles the entry
    // to the red Logs state, and the live run carries the failure note.
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body).error).toContain('container still running')
    expect(service.readRunLog('stop-fail').text).toContain('container still running')
    expect(service.readRunLog('stop-fail').running).toBe(false)
  })
})

describe('route handler error branches', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-err-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function fakeRes() {
    const res = {
      status: 0,
      body: '',
      writeHead(status: number): typeof res {
        res.status = status
        return res
      },
      end(body?: string): typeof res {
        res.body = body ?? ''
        return res
      },
    }
    return res
  }

  function fakeReq(method: string, url: string, body?: string) {
    const chunks = body !== undefined ? [Buffer.from(body)] : []
    return {
      method,
      url,
      destroy(): void {
        /* the handlers only destroy on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        for (const chunk of chunks) {
          yield chunk
        }
      },
    }
  }

  function routes(service: LocalInferService) {
    const list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    registerLocalInferRoute(
      {
        webServer: {
          register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
            list.push(route)
            return () => {
              /* the test owns the list */
            }
          },
        },
        effect(fn: () => unknown): void {
          fn()
        },
      } as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    return list
  }

  const find = (list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[], path: string) =>
    list.find((route) => route.path === path)!

  it('answers 413 when a save payload exceeds the 64 KiB cap', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const big = JSON.stringify({ engine: 'ninfer', config: { pad: 'x'.repeat(65 * 1024) } })
    const res = fakeRes()
    await save.handler(fakeReq('POST', '/local-infer/save', big), res)
    expect(res.status).toBe(413)
    expect(JSON.parse(res.body).error).toContain('too large')
  })

  it('answers 400 when a save body is not valid JSON', async () => {
    // A broken save body is a client error, so the save route answers 400
    // where the other POST routes answer 500.
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(fakeReq('POST', '/local-infer/save', '{not json'), res)
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toBeDefined()
  })

  it('persists the help toggle through the save route', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: false }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    // The stored file carries the toggle, and a body that omits it keeps
    // the descriptions visible.
    expect(readConfig().showHelp).toBe(false)
    const again = fakeRes()
    await save.handler(
      fakeReq('POST', '/local-infer/save', JSON.stringify({ engine: 'ninfer', config: {} })),
      again,
    )
    expect(again.status).toBe(200)
    expect(readConfig().showHelp).toBe(true)
  })

  it('reads the summary config query param, falling back on a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const summary = find(list, '/local-infer/summary')
    // A valid config param round-trips into the summary.
    const good = fakeRes()
    await summary.handler(
      fakeReq('GET', '/local-infer/summary?engine=ninfer&config=' + encodeURIComponent(JSON.stringify({ maxContext: 4096 }))),
      good,
    )
    expect(good.status).toBe(200)
    // A broken config param reads as absent, so the summary still answers.
    const broken = fakeRes()
    await summary.handler(
      fakeReq('GET', '/local-infer/summary?engine=ninfer&config={broken'),
      broken,
    )
    expect(broken.status).toBe(200)
  })

  it('reads the deps config query param the same way', async () => {
    const service = stubService([], { deps: [TEST_DEP] })
    const list = routes(service)
    const deps = find(list, '/local-infer/deps')
    const res = fakeRes()
    await deps.handler(
      fakeReq('GET', '/local-infer/deps?engine=ninfer&config=' + encodeURIComponent(JSON.stringify({ maxContext: 4096 }))),
      res,
    )
    expect(res.status).toBe(200)
  })

  it('answers 413 for an oversize register payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const register = find(list, '/local-infer/register')
    const bigRes = fakeRes()
    await register.handler(
      fakeReq('POST', '/local-infer/register', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await register.handler(fakeReq('POST', '/local-infer/register', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('answers 413 for an oversize launch payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const launch = find(list, '/local-infer/launch')
    const bigRes = fakeRes()
    await launch.handler(
      fakeReq('POST', '/local-infer/launch', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await launch.handler(fakeReq('POST', '/local-infer/launch', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('answers 413 for an oversize stop payload and 500 for a broken one', async () => {
    const service = stubService([])
    const list = routes(service)
    const stop = find(list, '/local-infer/stop')
    const bigRes = fakeRes()
    await stop.handler(
      fakeReq('POST', '/local-infer/stop', JSON.stringify({ engine: 'ninfer', pad: 'x'.repeat(65 * 1024) })),
      bigRes,
    )
    expect(bigRes.status).toBe(413)
    const brokenRes = fakeRes()
    await stop.handler(fakeReq('POST', '/local-infer/stop', '{broken'), brokenRes)
    expect(brokenRes.status).toBe(500)
  })

  it('serves the download route and maps the service answer through', async () => {
    let seen: { entry: DefaultModel; directory: string } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    const list = routes(service)
    const download = find(list, '/local-infer/download')
    const res = fakeRes()
    await download.handler(
      fakeReq(
        'POST',
        '/local-infer/download',
        JSON.stringify({ engine: 'ninfer', model: 'qwen3-27b', directory: '/custom/models' }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(seen?.entry?.modelId).toBe('qwen3-27b')
    expect(seen?.directory).toBe('/custom/models')
  })

  it('answers 404 for a download the default list does not name', async () => {
    const list = routes(stubService([]))
    const download = find(list, '/local-infer/download')
    const res = fakeRes()
    await download.handler(
      fakeReq('POST', '/local-infer/download', JSON.stringify({ engine: 'strata' })),
      res,
    )
    expect(res.status).toBe(404)
    expect(JSON.parse(res.body).error).toContain('no default model')
  })

  it('serves the chat-template route and maps the service answer through', async () => {
    let seen: { repo: string; directory: string } | undefined
    const service = stubService([], {
      onDownloadChatTemplate: (args) => {
        seen = args
      },
    })
    const list = routes(service)
    const chatTemplate = find(list, '/local-infer/chat-template')
    const res = fakeRes()
    await chatTemplate.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({
          engine: 'ninfer',
          template: 'froggeric/Qwen-Fixed-Chat-Templates',
          directory: '/custom/models',
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(seen?.repo).toBe('froggeric/Qwen-Fixed-Chat-Templates')
    expect(seen?.directory).toBe('/custom/models')
  })

  it('answers 400 for a chat template that is not an HF repo reference', async () => {
    const list = routes(stubService([]))
    const chatTemplate = find(list, '/local-infer/chat-template')
    const res = fakeRes()
    await chatTemplate.handler(
      fakeReq(
        'POST',
        '/local-infer/chat-template',
        JSON.stringify({ template: '/local/path/chat_template.jinja' }),
      ),
      res,
    )
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('HF repo reference')
  })
})
