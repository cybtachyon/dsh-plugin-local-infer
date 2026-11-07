/**
 * The run-log hub wiring (begin/append/endRun, live subscribers, reset
 * detection, the run paths bracketing the hub) and the logs route
 * (GET /local-infer/logs stream). (Split from route.spec.ts by describe,
 * TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DefaultModel, LifecycleHost } from 'dsh-plugin-local-infer/core'
import { DEFAULT_LOG_PATH_TEMPLATE, SUDO_CLI_NOTE, hfChatTemplateCommand, hfDownloadCommand } from 'dsh-plugin-local-infer/core'
import type { DownloadModelOptions, DownloadResult, EngineDeathEvent, LocalInferService, RunLogListener } from 'dsh-plugin-local-infer/service'
import { readConfig, writeConfig } from '../src/config.ts'
import type { StoredProviderConfig } from '../src/config.ts'
import { CANCELED_LINE, handleEngineDeath, launchEngine, stopEngine } from '../src/ops/engine.ts'
import { DOWNLOAD_RUN_SEED, GET_RUN_SEED, INSTALL_RUN_SEED, LAUNCH_RUN_SEED, STOP_RUN_SEED } from '../src/ops/logs.ts'
import { downloadFor } from '../src/ops/hf.ts'
import { registerLocalInferRoute } from '../src/route.ts'
import { MODEL_DIR, TEST_DEP, argvAdapter, pointHomeAt, stubGetHost, stubService } from './fixtures.ts'

describe('run-log hub wiring', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-hub-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * hubRoutes registers every route over a fake web server and answers the
   * one for a path; getHost feeds the Get route's stub host, launchHost the
   * launch route's.
   */
  function hubRoutes(service: LocalInferService, getHost?: LifecycleHost, launchHost?: LifecycleHost) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
      getHost,
      launchHost,
    )
    return (path: string) => routes.find((route) => route.path === path)!
  }

  function hubRes() {
    const res = {
      status: 0,
      body: '',
      chunks: [] as string[],
      closeListeners: [] as Array<() => void>,
      writeHead(status: number) {
        res.status = status
        return res
      },
      write(chunk: string) {
        res.chunks.push(chunk)
        return true
      },
      end(body?: string) {
        res.body = body ?? ''
        return res
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  function hubPost(path: string, body: Record<string, unknown>) {
    return {
      method: 'POST',
      url: path,
      destroy(): void {
        /* the handlers only destroy on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        yield Buffer.from(JSON.stringify(body))
      },
    }
  }

  /**
   * untilTrue waits on the timer queue until the predicate holds, so a test
   * can wait for a handler to reach its gate without a fixed sleep.
   */
  async function untilTrue(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  function providerWithLaunchRecord(id: string): StoredProviderConfig {
    return {
      id,
      engine: 'infernix',
      config: { model: 'qwen3-27b', port: 18080 },
      platform: {},
      launch: {
        pid: 4242,
        startedAt: '2026-10-23T12:00:00.000Z',
        argv: ['infernix-serve', '--port', '18080'],
        previousPids: [],
        engineId: 'infernix',
        modelId: 'qwen3-27b',
        port: 18080,
      },
    }
  }

  it('brackets the Get run under the matched entry key and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-get',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    // The model artifact starts absent, so the download step's command line
    // lands in the run and names this entry's model.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    const route = hubRoutes(service, stubGetHost({ exists: false }).host)('/local-infer/get')
    const res = hubRes()
    await route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      res,
    )
    // The run key is the stored entry the engine and model match names, and
    // the buffer holds the seed, the Get steps, and the settle line in order.
    const snapshot = service.readRunLog('hub-get')
    expect(snapshot.running).toBe(false)
    expect(snapshot.text.startsWith(GET_RUN_SEED)).toBe(true)
    const cloneAt = snapshot.text.indexOf('$ git clone')
    const downloadAt = snapshot.text.indexOf('$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer')
    const completeAt = snapshot.text.indexOf('get complete')
    expect(cloneAt).toBeGreaterThan(GET_RUN_SEED.length - 1)
    expect(downloadAt).toBeGreaterThan(cloneAt)
    expect(completeAt).toBeGreaterThan(downloadAt)
    // The download's command line leads the run's output for that step and
    // lands exactly once (the service writes it; nothing repeats it).
    expect(snapshot.text.split('$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer').length - 1).toBe(
      1,
    )
    // A draft under the engine-id fallback key stayed untouched.
    expect(service.readRunLog('ninfer')).toEqual({ seq: 0, text: '', running: false })
  })

  it('keeps concurrent runs under different keys from interleaving', async () => {
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-a',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
      {
        id: 'hub-b',
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    const route = hubRoutes(service, stubGetHost({ exists: false }).host)('/local-infer/get')
    await Promise.all([
      route.handler(
        hubPost('/local-infer/get', {
          engine: 'ninfer',
          config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        }),
        hubRes(),
      ),
      route.handler(
        hubPost('/local-infer/get', {
          engine: 'ninfer',
          config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        }),
        hubRes(),
      ),
    ])
    // Each key holds only its own run: one entry's model names never reach
    // the other's buffer, and both settle.
    const a = service.readRunLog('hub-a')
    const b = service.readRunLog('hub-b')
    expect(a.text).toContain('Qwen3.8-27B')
    expect(a.text).not.toContain('Qwen3.6-35B')
    expect(b.text).toContain('Qwen3.6-35B')
    expect(b.text).not.toContain('Qwen3.8-27B')
    expect(a.running).toBe(false)
    expect(b.running).toBe(false)
  })

  it("keeps two concurrent runs' sudo note routing independent: both hear, one settle keeps the other", async () => {
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true, undefined, true, [
      {
        id: 'hub-sudo-a',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
      {
        id: 'hub-sudo-b',
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    // Gate each run at its model download: both Get runs sit in flight with
    // their sudo hooks registered, so the first run can settle while the
    // second is still open (the case the single observer slot got wrong).
    const gates = new Map<string, () => void>()
    service.downloadModel = (entry) =>
      new Promise<DownloadResult>((resolve) => {
        gates.set(entry.modelId, () => resolve({ ok: true }))
      })
    const route = hubRoutes(service, stubGetHost({ exists: true }).host)('/local-infer/get')
    const settleA = route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      hubRes(),
    )
    await untilTrue(() => gates.has('qwen3-27b'))
    const settleB = route.handler(
      hubPost('/local-infer/get', {
        engine: 'ninfer',
        config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR },
      }),
      hubRes(),
    )
    await untilTrue(() => gates.has('qwen36-35b'))
    const command = 'sudo ln -sf ./build/engine /usr/local/bin/engine'
    service.notifySudoNeeded(command)
    // The shared CLI password wait notes both runs: each key's live buffer
    // carries its own `!!` note line.
    expect(service.readRunLog('hub-sudo-a').text).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    expect(service.readRunLog('hub-sudo-b').text).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    // Settle run A only: run B keeps its hook slot (the first settle no
    // longer clears another run's note routing).
    gates.get('qwen3-27b')?.()
    await settleA
    service.notifySudoNeeded(command)
    expect(service.readRunLog('hub-sudo-a').text.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    expect(service.readRunLog('hub-sudo-b').text.split(SUDO_CLI_NOTE).length - 1).toBe(2)
    gates.get('qwen36-35b')?.()
    await settleB
    expect(service.readRunLog('hub-sudo-a').running).toBe(false)
    expect(service.readRunLog('hub-sudo-b').running).toBe(false)
  })

  it('brackets the launch run with the seed, Get steps, command note, build, and engine output in order', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, false, undefined, true, [
      {
        id: 'hub-launch',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      engines: [argvAdapter('ninfer', ['ninfer-serve', '--port', '18080'])],
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        buildLogs: 'build output\n',
        logs: 'engine output\n',
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        providerId: 'hub-launch',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      },
      undefined,
      stubGetHost({ exists: false }).host,
    )
    const snapshot = service.readRunLog('hub-launch')
    expect(snapshot.running).toBe(false)
    const order = [
      LAUNCH_RUN_SEED,
      '$ git clone',
      '$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer',
      '[local-infer] launch: ninfer-serve',
      'build output',
      'engine output',
    ].map((needle) => snapshot.text.indexOf(needle))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    // The download's audit line appears exactly once in the launch run too:
    // the launch-embedded Get writes it through the service, not a second
    // time from the launch's own note path.
    expect(
      snapshot.text.split('$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer').length - 1,
    ).toBe(1)
  })

  it('settles a canceled launch with the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, false, undefined, true, [
      {
        id: 'hub-cancel',
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        platform: {},
      },
    ])
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([])
    // A download that writes its `$ <command>` line (as the service does) and
    // then hangs until the route's cancel aborts the signal.
    service.downloadModel = (
      entry: DefaultModel,
      directory: string,
      options?: DownloadModelOptions,
    ) => {
      options?.onLog?.(
        `$ ${hfDownloadCommand(entry, directory, options?.useHubCache === true)}\n`,
      )
      return new Promise<DownloadResult>((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, detail: 'download canceled' })
          },
          { once: true },
        )
      })
    }
    const route = hubRoutes(service, undefined, stubGetHost({ exists: false }).host)(
      '/local-infer/launch',
    )
    const res = hubRes()
    const pending = route.handler(
      hubPost('/local-infer/launch', {
        engine: 'ninfer',
        providerId: 'hub-cancel',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
      }),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    const snapshot = service.readRunLog('hub-cancel')
    expect(snapshot.text).toContain('Qwen3.8-27B')
    expect(snapshot.text.endsWith(CANCELED_LINE)).toBe(true)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the download run with streamed hf chunks and the settle line', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b' }, false, undefined, true, [
      { id: 'hub-dl', engine: 'ninfer', config: { model: 'qwen36-35b' }, platform: {} },
    ])
    const service = stubService([])
    // The stub download plays the hf runner's chunk callback and the service's
    // `$ <command>` emit (through onLog before the download runs), the way the
    // real service writes the exec audit line ahead of the streamed output.
    service.downloadModel = (
      entry: DefaultModel,
      directory: string,
      options?: DownloadModelOptions,
    ) => {
      options?.onLog?.(
        `$ ${hfDownloadCommand(entry, directory, options?.useHubCache === true)}\n`,
      )
      options?.onChunk?.('hf: downloading 42%\n')
      return Promise.resolve({ ok: true })
    }
    const route = hubRoutes(service)('/local-infer/download')
    const res = hubRes()
    await route.handler(
      hubPost('/local-infer/download', {
        engine: 'ninfer',
        model: 'qwen36-35b',
        directory: MODEL_DIR,
      }),
      res,
    )
    expect(res.status).toBe(200)
    const snapshot = service.readRunLog('hub-dl')
    // The exec audit rule: the `$ hf download` line leads the streamed
    // output, and the run carries it exactly once (the service writes it, no
    // second copy from the route or the Get step).
    const commandAt = snapshot.text.indexOf('$ hf download')
    const chunkAt = snapshot.text.indexOf('hf: downloading 42%')
    const settleAt = snapshot.text.indexOf('download complete')
    expect(commandAt).toBeGreaterThanOrEqual(0)
    expect(commandAt).toBeLessThan(chunkAt)
    expect(chunkAt).toBeLessThan(settleAt)
    expect(snapshot.text.split('$ hf download').length - 1).toBe(1)
    expect(snapshot.running).toBe(false)
    // The persisted read model keeps its "Downloading..." section, now with
    // the same single command line, and no NDJSON leak.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('$ hf download')
    expect(readConfig().lastLogs).toContain('download complete')
    expect(readConfig().lastLogs.split('$ hf download').length - 1).toBe(1)
  })

  it('notes a failed download in the live run and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b' }, false, undefined, true, [
      { id: 'hub-dl-fail', engine: 'ninfer', config: { model: 'qwen36-35b' }, platform: {} },
    ])
    const service = stubService([], { downloadResult: { ok: false, detail: 'hf exploded' } })
    await downloadFor(service, { engine: 'ninfer', model: 'qwen36-35b', directory: MODEL_DIR })
    const snapshot = service.readRunLog('hub-dl-fail')
    // The command line leads the failure note: the run reads what was tried
    // before what went wrong.
    const seedAt = snapshot.text.indexOf(DOWNLOAD_RUN_SEED)
    const commandAt = snapshot.text.indexOf('$ hf download')
    const noteAt = snapshot.text.indexOf('!! download failed: hf exploded')
    expect(seedAt).toBe(0)
    expect(commandAt).toBeGreaterThan(seedAt)
    expect(noteAt).toBeGreaterThan(commandAt)
    expect(snapshot.text.endsWith('!! download failed: hf exploded\n')).toBe(true)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the chat-template run under the engine-and-model key', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b', chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
      false,
      undefined,
      true,
      [{ id: 'hub-tpl', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} }],
    )
    const service = stubService([])
    service.downloadChatTemplate = (
      repo: string,
      directory: string,
      options?: DownloadModelOptions,
    ) => {
      options?.onLog?.(
        `$ ${hfChatTemplateCommand(repo, directory, options?.useHubCache === true)}\n`,
      )
      options?.onChunk?.('template fetched\n')
      return Promise.resolve({ ok: true })
    }
    const route = hubRoutes(service)('/local-infer/chat-template')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/chat-template', { directory: MODEL_DIR }), res)
    expect(res.status).toBe(200)
    const snapshot = service.readRunLog('hub-tpl')
    // The exec audit rule for the template download too: the `$ hf download`
    // line for the template repo leads the streamed output, exactly once.
    const commandAt = snapshot.text.indexOf('$ hf download froggeric/Qwen-Fixed-Chat-Templates')
    const chunkAt = snapshot.text.indexOf('template fetched')
    expect(commandAt).toBeGreaterThanOrEqual(0)
    expect(commandAt).toBeLessThan(chunkAt)
    expect(snapshot.text.split('$ hf download').length - 1).toBe(1)
    expect(snapshot.running).toBe(false)
  })

  it('brackets the install run with the per-dep results and settles it', async () => {
    writeConfig('ninfer', {}, true)
    const service = stubService([], { deps: [TEST_DEP] })
    const route = hubRoutes(service)('/local-infer/install')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/install', { engine: 'ninfer' }), res)
    expect(res.status).toBe(200)
    // No provider entry matches the draft, so the key falls back to the
    // engine id. The exec audit rule leads the run: the install command's
    // `$ <command>` line lands before the re-checked dep's result, in the Get
    // step's shape.
    const snapshot = service.readRunLog('ninfer')
    expect(snapshot.text).toBe(
      `${INSTALL_RUN_SEED}$ sudo apt install cmake\n  cmake: satisfied\n`,
    )
    expect(snapshot.running).toBe(false)
  })

  it('persists the install settle text so a reload shows the last install run', async () => {
    writeConfig('ninfer', {}, true)
    const service = stubService([], { deps: [TEST_DEP] })
    const route = hubRoutes(service)('/local-infer/install')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/install', { engine: 'ninfer' }), res)
    expect(res.status).toBe(200)
    // The settle fold: the run's text (seed, the install command line, the
    // per-dep result) lands in the stored last-run logs, the same reload read
    // model the other provider processes write, in the same section order.
    expect(readConfig().lastLogs).toBe(
      `${INSTALL_RUN_SEED}$ sudo apt install cmake\n  cmake: satisfied\n`,
    )
  })

  it('starts no hub run for a refused (409) install', async () => {
    writeConfig('ninfer', {}, false)
    const service = stubService([], { deps: [TEST_DEP] })
    const route = hubRoutes(service)('/local-infer/install')
    const res = hubRes()
    await route.handler(hubPost('/local-infer/install', { engine: 'ninfer' }), res)
    expect(res.status).toBe(409)
    expect(service.readRunLog('ninfer')).toEqual({ seq: 0, text: '', running: false })
  })

  it('brackets the stop run under the provider key', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, undefined, true, [
      { id: 'hub-stop', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    await stopEngine(service, { engine: 'ninfer', providerId: 'hub-stop' })
    const snapshot = service.readRunLog('hub-stop')
    expect(snapshot.text).toBe(STOP_RUN_SEED)
    expect(snapshot.running).toBe(false)
  })

  it('notes a stop failure in the live run and settles it', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, undefined, true, [
      { id: 'hub-stop-fail', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    service.stop = async (): Promise<void> => {
      throw new Error('kill failed')
    }
    await expect(
      stopEngine(service, { engine: 'ninfer', providerId: 'hub-stop-fail' }),
    ).rejects.toThrow('kill failed')
    const snapshot = service.readRunLog('hub-stop-fail')
    expect(snapshot.text).toContain(
      '[local-infer] stop failed for ninfer (qwen3-27b): kill failed',
    )
    expect(snapshot.running).toBe(false)
  })

  it('lands a late engine-death note without stranding the key as running', () => {
    const event: EngineDeathEvent = {
      engineId: 'infernix',
      port: 18080,
      pid: 4242,
      code: null,
      signal: 'SIGTERM',
    }
    // An open run: the note joins the live buffer and the running flag
    // stays set (the run owns its own end).
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-death')],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const open = stubService([])
    open.beginRun('hub-death', 'engine up\n')
    handleEngineDeath(event, open)
    const openRun = open.readRunLog('hub-death')
    expect(openRun.text).toContain('engine up\n')
    expect(openRun.text).toContain('pid 4242 exited on signal SIGTERM')
    expect(openRun.running).toBe(true)
    // A settled run: the late append reopens the key, so the death handler
    // settles it again right away.
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-death')],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const settled = stubService([])
    handleEngineDeath(event, settled)
    const lateNote = settled.readRunLog('hub-death')
    expect(lateNote.text).toContain('pid 4242 exited on signal SIGTERM')
    expect(lateNote.running).toBe(false)
    // An event matching no launch record leaves the hub untouched.
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [{ id: 'hub-death', engine: 'infernix', config: { model: 'qwen3-27b', port: 18080 }, platform: {} }],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    const quiet = stubService([])
    handleEngineDeath(event, quiet)
    expect(quiet.readRunLog('hub-death')).toEqual({ seq: 0, text: '', running: false })
  })

  it('wires the mounted death observer through the service hub', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithLaunchRecord('hub-wired')],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    let observer: ((event: EngineDeathEvent) => void) | undefined
    const service = stubService([], {
      onSetDeathObserver: (next): void => {
        observer = next
      },
    })
    hubRoutes(service)('/local-infer/summary')
    observer?.({ engineId: 'infernix', port: 18080, pid: 4242, code: 1, signal: null })
    // The route's observer closure captured the service, so the note reaches
    // the hub key and the reopened run settles.
    const snapshot = service.readRunLog('hub-wired')
    expect(snapshot.text).toContain('engine infernix (port 18080) pid 4242 exited with exit code 1')
    expect(snapshot.running).toBe(false)
  })
})

describe('logs route (GET /local-infer/logs stream)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-logs-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * logsRouteAt registers every route over a fake web server and answers
   * the logs route's definition.
   */
  function logsRouteAt(service: LocalInferService) {
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
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
    )
    return routes.find((route) => route.path === '/local-infer/logs')!
  }

  function logsRes() {
    const res = {
      status: 0,
      ended: false,
      headers: {} as Record<string, string>,
      chunks: [] as string[],
      closeListeners: [] as Array<() => void>,
      writeHead(status: number, headers?: Record<string, string>) {
        res.status = status
        Object.assign(res.headers, headers ?? {})
        return res
      },
      write(chunk: string) {
        res.chunks.push(chunk)
        return true
      },
      end() {
        res.ended = true
        return res
      },
      // The logs route watches the response's client disconnect to dispose
      // its hub subscription; the fake captures the listener so a test
      // simulates the card's pane closing the stream.
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  function fakeGet(url: string) {
    return {
      method: 'GET',
      url,
      destroy(): void {
        /* a GET request carries no body to destroy */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {},
    }
  }

  // logsEvents parses the logs route's NDJSON chunks into events, so a test
  // reads the snapshot, runBegin, log, and runEnd lines in stream order.
  function logsEvents(chunks: string[]): Record<string, unknown>[] {
    return chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('writes the catch-up snapshot first and follows appends and the run end', async () => {
    const service = stubService([])
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=pane'), res)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    // A key that never ran streams the empty snapshot and stays attached.
    expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
    // A new run reaches the attached reader as a runBegin line, the appends
    // as log lines continuing the seq, and the settle as a runEnd line.
    service.beginRun('pane', '--- Launching...\n')
    service.appendRunLog('pane', 'engine up\n')
    service.appendRunLog('pane', 'healthy\n')
    service.endRun('pane')
    expect(logsEvents(res.chunks).slice(1)).toEqual([
      { runBegin: '--- Launching...\n', seq: 0 },
      { log: 'engine up\n', seq: 1 },
      { log: 'healthy\n', seq: 2 },
      { runEnd: true, seq: 2 },
    ])
  })

  it('catches a late reader up with the buffered text, the seq, and the running flag', async () => {
    const service = stubService([])
    service.beginRun('late', '--- Launching...\n')
    service.appendRunLog('late', 'step one\n')
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=late'), res)
    // The snapshot carries everything the pane missed, with the running flag.
    expect(logsEvents(res.chunks)).toEqual([
      { snapshot: '--- Launching...\nstep one\n', seq: 1, running: true },
    ])
    // Live appends continue the snapshot's seq.
    service.appendRunLog('late', 'step two\n')
    service.endRun('late')
    expect(logsEvents(res.chunks).slice(1)).toEqual([
      { log: 'step two\n', seq: 2 },
      { runEnd: true, seq: 2 },
    ])
  })

  it('does not duplicate an append that lands between subscribe and the snapshot read', async () => {
    const service = stubService([])
    service.beginRun('race', 'seed\n')
    service.appendRunLog('race', 'first\n')
    const read = service.readRunLog.bind(service)
    // The raced append: it lands after the route subscribed but before the
    // route read the snapshot, so its text is already inside the snapshot.
    service.readRunLog = (key: string) => {
      service.appendRunLog(key, 'raced\n')
      return read(key)
    }
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=race'), res)
    const events = logsEvents(res.chunks)
    // The snapshot stays the stream's first line and already holds the raced
    // chunk.
    expect(events[0]).toEqual({
      snapshot: 'seed\nfirst\nraced\n',
      seq: 2,
      running: true,
    })
    // The raced append never streams a second time...
    expect(events.filter((event) => event.log === 'raced\n')).toEqual([])
    // ...and a later append still streams above the dedup watermark.
    service.appendRunLog('race', 'after\n')
    expect(logsEvents(res.chunks).at(-1)).toEqual({ log: 'after\n', seq: 3 })
  })

  it('disposes the hub subscription when the client disconnects', async () => {
    const service = stubService([])
    let disposed = false
    const subscribe = service.subscribeRunLog.bind(service)
    service.subscribeRunLog = (key: string, listener: RunLogListener): (() => void) => {
      const dispose = subscribe(key, listener)
      return () => {
        disposed = true
        dispose()
      }
    }
    const route = logsRouteAt(service)
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=gone'), res)
    expect(res.closeListeners).toHaveLength(1)
    // The card's pane closing fires the node 'close'.
    res.closeListeners[0]!()
    expect(disposed).toBe(true)
    // The dead connection stops receiving hub events.
    service.beginRun('gone', 'seed\n')
    expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
  })

  it('closes open stream connections when the route effect disposes', async () => {
    const service = stubService([])
    // A bundle switch off runs the route effect's disposer: it must detach
    // the streams still open, so no hub listener outlives the registration.
    const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
    let disposeEffect: (() => void) | undefined
    const scope = {
      webServer: {
        register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
          routes.push(route)
          return () => undefined
        },
      },
      effect(fn: () => unknown): void {
        disposeEffect = fn() as (() => void) | undefined
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      service,
    )
    const route = routes.find((entry) => entry.path === '/local-infer/logs')!
    service.beginRun('card-live', '--- Launching...\n')
    const res = logsRes()
    await route.handler(fakeGet('/local-infer/logs?provider=card-live'), res)
    service.appendRunLog('card-live', 'live line\n')
    const streamed = res.chunks.length
    expect(logsEvents(res.chunks).at(-1)).toEqual({ log: 'live line\n', seq: 1 })
    disposeEffect?.()
    // The still-open connection is ended on the wire...
    expect(res.ended).toBe(true)
    // ...and detached from the hub: later run events reach nothing.
    service.appendRunLog('card-live', 'after dispose\n')
    service.beginRun('card-live', '--- Launching...\n')
    expect(res.chunks).toHaveLength(streamed)
  })

  it('streams the empty snapshot and stays attached for a blank or unknown key', async () => {
    const service = stubService([])
    const route = logsRouteAt(service)
    // The missing provider param is the blank key; both keys stream an open
    // empty stream rather than a 404.
    const cases = [
      ['/local-infer/logs', ''],
      ['/local-infer/logs?provider=never-ran', 'never-ran'],
    ] as const
    for (const [url, key] of cases) {
      const res = logsRes()
      await route.handler(fakeGet(url), res)
      expect(res.status).toBe(200)
      expect(logsEvents(res.chunks)).toEqual([{ snapshot: '', seq: 0, running: false }])
      // Still attached: a run that starts later reaches this connection.
      service.beginRun(key, 'late start\n')
      expect(logsEvents(res.chunks).at(-1)).toEqual({ runBegin: 'late start\n', seq: 0 })
    }
  })
})
