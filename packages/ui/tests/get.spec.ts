/**
 * The get route (git sync, deps, build), the shared Get-steps routine, and
 * engine death persistence. (Split from route.spec.ts by describe,
 * TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DefaultModel, LifecycleHost, ProviderRef } from 'dsh-plugin-local-infer/core'
import { DEFAULT_LOG_PATH_TEMPLATE, SUDO_CLI_NOTE, dshEngineCacheDirectory, hfDownloadCommand } from 'dsh-plugin-local-infer/core'
import type { DownloadResult, EngineDeathEvent, LocalInferService } from 'dsh-plugin-local-infer/service'
import { readConfig, writeConfig } from '../src/config.ts'
import type { StoredProviderConfig } from '../src/config.ts'
import { getEngine, handleEngineDeath, launchEngine } from '../src/ops/engine.ts'
import { runGetSteps } from '../src/ops/get-steps.ts'
import { registerLocalInferRoute } from '../src/route.ts'
import { buildSummary } from '../src/viewmodels/summary.ts'
import { MODEL_DIR, TEST_DEP, pointHomeAt, stubGetHost, stubService } from './fixtures.ts'

describe('get route (git sync, deps, build)', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-get-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function fakeStreamRes() {
    const res = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
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
      end(body?: string) {
        res.body = body ?? ''
        return res
      },
      // The get route watches the response's client disconnect (the node
      // 'close' before the route ends); the fake captures the listener so a
      // test simulates the card's Cancel closing the stream.
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === 'close') {
          res.closeListeners.push(listener as () => void)
        }
        return res
      },
    }
    return res
  }

  // ndjsonEvents parses the get route's NDJSON stream chunks into events, so
  // a test reads the progress events the route wrote (and asserts the
  // answer carries no log events: TASK-005 moved the run text to the hub).
  function ndjsonEvents(
    chunks: string[],
  ): Array<{ log?: string; progress?: Record<string, unknown> }> {
    return chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { log?: string; progress?: Record<string, unknown> })
  }

  function getRouteWith(host: LifecycleHost | undefined, service: LocalInferService = stubService([])) {
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
      host,
    )
    return routes.find((route) => route.path === '/local-infer/get')!
  }

  function fakePost(body: string) {
    return {
      method: 'POST',
      url: '/local-infer/get',
      destroy(): void {
        /* the handler only destroys on an oversize body */
      },
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        yield Buffer.from(body)
      },
    }
  }

  it('clones the upstream repo into the engine cache home when no override is set', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: {} },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The default checkout home is ~/.cache/dsh/infer/<engine-id>, never a
    // subfolder of the model directory.
    expect(logged).toContain(`$ git clone https://github.com/Neroued/ninfer ${dshEngineCacheDirectory('ninfer')}`)
    // The build steps run after the sync, with the checkout path substituted.
    expect(logged).toContain(`cmake -S ${dshEngineCacheDirectory('ninfer')}`)
    expect(logged).toContain('get complete')
  })

  it('uses the Engine Directory override and clones the fork when both are stored', async () => {
    writeConfig('ninfer', {}, true, { ninfer: { engineDirectory: '/src/ninfer', engineFork: 'https://github.com/me/ninfer' } })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: {} },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).toContain('$ git clone https://github.com/me/ninfer /src/ninfer')
    expect(logged).toContain('cmake -S /src/ninfer')
  })

  it('aborts with a Logs alert when the checkout has local changes', async () => {
    writeConfig('ninfer', {}, true)
    const { host, state } = stubGetHost({ stream: { 'status --short': ' M src/engine.c\n' } })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('local changes')
    expect(logged).toContain('has local changes. Get aborted')
    // The abort stops the step: no build runs.
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
  })

  it('re-checks deps with the trust gate off and aborts on a missing dep', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([], { deps: [TEST_DEP] }),
      { engine: 'ninfer', config: { buildMode: 'local' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('a system dependency is missing')
    expect(logged).toContain('  cmake: missing')
    expect(logged).toContain('one-click install is off')
    // The missing dep stops the step before the build.
    expect(logged).not.toContain('cmake -S')
  })

  it('logs per-dep results when the trust gate is on', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([], { deps: [TEST_DEP] }),
      { engine: 'ninfer', config: { buildMode: 'local' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).toContain('system dependencies (local)')
    expect(logged).toContain('  cmake: satisfied')
    expect(logged).toContain('get complete')
  })

  it('persists the run to the last logs and the run-log hub, streaming no log lines itself', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    const service = stubService([])
    const route = getRouteWith(host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    // TASK-005: the Get answer carries progress events only. The run's text
    // reaches the card through the run-log hub (the logs route's source), so
    // one line never lands twice.
    const events = ndjsonEvents(res.chunks)
    expect(events.some((event) => event.log !== undefined)).toBe(false)
    const hubText = service.readRunLog('ninfer').text
    expect(hubText).toContain('$ git clone')
    expect(hubText).toContain('get complete')
    // The run persists as the last logs the Logs section shows, under
    // the "Getting engine and model..." separator the route writes when the
    // Get button is clicked.
    expect(readConfig().lastLogs).toContain('--- Getting engine and model...')
    expect(readConfig().lastLogs).toContain('get complete')
  })

  it('persists and feeds the hub the CLI sudo note when the host announces a waiting sudo', async () => {
    writeConfig('ninfer', {}, true)
    const sudoHooks: Array<Array<{ key: string }>> = []
    const service = stubService([], {
      onSudoObservers: (hooks) => {
        sudoHooks.push(hooks.map((hook) => ({ key: hook.key })))
      },
    })
    // The stub host plays the guarded node host: the body's sudo build
    // command is announced through the service's notify seam before it runs,
    // the way the real host announces after a credential probe that found
    // nothing cached.
    const host = stubGetHost({
      announceSudo: (command) => service.notifySudoNeeded(command),
    }).host
    const route = getRouteWith(host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(
        JSON.stringify({
          engine: 'ninfer',
          config: { modelDirectory: MODEL_DIR },
          platform: { buildCommands: 'sudo ln -sf ./build/engine /usr/local/bin/engine' },
        }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const hubText = service.readRunLog('ninfer').text
    // The note lands in the live hub run exactly once, prefixed with the
    // `!!` marker the Get step's own failure lines use.
    expect(hubText).toContain(`!! ${SUDO_CLI_NOTE}\n`)
    expect(hubText.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    // The note persists through persistProcessLog while the run is still
    // hung on the prompt, and the collected run persists with it under the
    // "Getting engine and model..." separator. finishRunSection closes the
    // run over the pre-run baseline, so the provisional mid-run note line
    // and the collected run text persist the note exactly once.
    expect(readConfig().lastLogs).toContain(`!! ${SUDO_CLI_NOTE}`)
    expect(readConfig().lastLogs.split(SUDO_CLI_NOTE).length - 1).toBe(1)
    expect(readConfig().lastLogs).toContain('--- Getting engine and model...')
    // The Get route streams no control-state event and no log lines (Q2):
    // the answer carries only progress events.
    const events = ndjsonEvents(res.chunks)
    expect(events.every((event) => event.progress !== undefined)).toBe(true)
    // The run registered its hook under the draft's key and cleared it when
    // it settled: one live hook at register, none at dispose.
    expect(sudoHooks).toEqual([[{ key: 'ninfer' }], []])
  })

  it('writes the Get run (commands and output) to the configured log file', async () => {
    writeConfig('ninfer', {}, true)
    // The per-run log name carries a second-resolution timestamp: an earlier
    // test's run in a different second would otherwise sort first under the
    // same ninfer- prefix and be read here. Clear the directory so this
    // run's file is the only ninfer-*.log to find.
    const logDir = join(home, '.dsh', 'local-infer', 'logs')
    rmSync(logDir, { recursive: true, force: true })
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(JSON.stringify({ engine: 'ninfer', config: { modelDirectory: MODEL_DIR } })),
      res,
    )
    // The Get step owns a per-run log file too: the commands and their output
    // land in the configured log directory under the "Getting engine and
    // model..." separator.
    const entries = existsSync(logDir) ? readdirSync(logDir) : []
    const logFile = entries.find((name) => name.startsWith('ninfer-') && name.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = readFileSync(join(logDir, logFile!), 'utf8')
    expect(content).toContain('--- Getting engine and model...')
    expect(content).toContain('$ git clone')
    expect(content).toContain('get complete')
  })

  it('persists the streamed output on top of the previous last logs', async () => {
    writeConfig('ninfer', {}, true, undefined, true, [], undefined, 'prior run')
    const { host } = stubGetHost({ exists: false })
    const route = getRouteWith(host)
    const res = fakeStreamRes()
    await route.handler(fakePost(JSON.stringify({ engine: 'ninfer' })), res)
    expect(readConfig().lastLogs).toContain('prior run')
    expect(readConfig().lastLogs).toContain('get complete')
  })

  it('downloads the DFlash2 drafter and the n-gram volume for an Infernix Get', async () => {
    writeConfig('infernix', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      {
        engine: 'infernix',
        config: {
          spec: 'dflash2',
          model: 'qwen38-flash-next',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The selected DFlash2 drafter downloads into the model directory, the
    // layout the --draft-model path expects, joined with the host separator.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix Qwen3.8-Flash-Next-DFlash2-Infernix.infernix --local-dir ${join(MODEL_DIR, 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix')} --format human`,
    )
    // The Flash-Next model's PLE n-gram volume downloads into the model
    // directory, so the --ngram-volume flag reads a file the same Get left.
    expect(logged).toContain(
      `$ hf download Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram --local-dir ${MODEL_DIR} --format human`,
    )
    expect(logged).toContain('get complete')
  })

  it('routes the Infernix extra-download chunks to the onChunk sink', async () => {
    writeConfig('infernix', {}, true)
    // The stubbed host.runStream hands the fake tqdm line to its chunk
    // callback, the way the real runner streams the hf download's stderr.
    const tqdmLine = '42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'
    const { host } = stubGetHost({
      exists: false,
      stream: {
        'hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix': tqdmLine,
      },
    })
    const chunks: string[] = []
    let logged = ''
    const result = await getEngine(
      stubService([]),
      {
        engine: 'infernix',
        config: {
          spec: 'dflash2',
          model: 'qwen38-flash-next',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.ok).toBe(true)
    // The chunk reaches the onChunk progress sink and the log sink together,
    // so the Infernix extra download feeds the same progress events the
    // model and template downloads do.
    expect(chunks).toEqual([tqdmLine])
    expect(logged).toContain(tqdmLine)
    expect(logged).toContain('get complete')
  })

  it('lands the extras success output when the host has no runStream', async () => {
    writeConfig('infernix', {}, true)
    // A host without a streaming surface: the extras fall back to the plain
    // run, whose clean-exit outcome carries the output tail. The step must
    // still land that output after its `$ <command>` line (the append-results
    // half of the exec rule), not discard it.
    const plainHost: LifecycleHost = {
      async run(command: string) {
        if (command.includes('rev-parse --is-inside-work-tree')) {
          return { ok: false }
        }
        if (command.includes('hf download')) {
          return { ok: true, stdout: 'extra artifact downloaded' }
        }
        return { ok: true }
      },
      spawn: () => ({ pid: 1, kill: (): void => {} }),
      async fetch() {
        return { status: 0, ok: false }
      },
    }
    let logged = ''
    const result = await getEngine(
      stubService([]),
      {
        engine: 'infernix',
        config: {
          spec: 'dflash2',
          model: 'qwen38-flash-next',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      plainHost,
    )
    expect(result.ok).toBe(true)
    const commandAt = logged.indexOf(
      '$ hf download Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix',
    )
    const outputAt = logged.indexOf('extra artifact downloaded\n')
    expect(commandAt).toBeGreaterThanOrEqual(0)
    expect(outputAt).toBeGreaterThan(commandAt)
    expect(logged.match(/extra artifact downloaded/g)).toHaveLength(2)
  })

  it('pulls no model artifacts for a non-Infernix Get', async () => {
    writeConfig('ninfer', {}, true)
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      stubService([]),
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    expect(logged).not.toContain('hf download')
    expect(logged).toContain('get complete')
  })

  it('hands the hf download raw stderr chunks to the onChunk sink', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const { host } = stubGetHost({ exists: false })
    const service = stubService([])
    // The stubbed download invokes the injected onChunk, the way the real
    // service hands the runner's streamed stderr chunks to it, and writes the
    // `$ <command>` line through onLog before the download, as the service does.
    service.downloadModel = (
      entry: DefaultModel,
      directory: string,
      options?: { onChunk?: (chunk: string) => void; onLog?: (line: string) => void },
    ) => {
      options?.onLog?.(`$ ${hfDownloadCommand(entry, directory, false)}\n`)
      options?.onChunk?.('42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n')
      return Promise.resolve({ ok: true })
    }
    const chunks: string[] = []
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.ok).toBe(true)
    // The raw tqdm line reaches the onChunk sink as it lands, separate from
    // the log text sink.
    expect(chunks).toEqual(['42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'])
    // The step log lines stay on the log sink, unchanged.
    expect(logged).toContain('$ hf download')
    expect(logged).toContain('get complete')
  })

  it('streams a progress event for the download tqdm chunks and keeps the persisted log plain text', async () => {
    // The qwen36-35b model names a log file the cancel test's prefix search
    // (ninfer-qwen3-27b-*) does not match, so the two tests own separate
    // per-run log files.
    writeConfig('ninfer', { model: 'qwen36-35b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
    rmSync(join(MODEL_DIR, 'qwen3_6_35b_a3b.ninfer'), { force: true })
    const service = stubService([])
    // The stubbed download invokes the injected onChunk with a tqdm line, the
    // way the real runner hands the hf download's streamed stderr to it.
    const tqdmLine = 'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n'
    service.downloadModel = (
      entry: DefaultModel,
      directory: string,
      options?: { onChunk?: (chunk: string) => void; onLog?: (line: string) => void },
    ) => {
      options?.onLog?.(`$ ${hfDownloadCommand(entry, directory, false)}\n`)
      options?.onChunk?.(tqdmLine)
      return Promise.resolve({ ok: true })
    }
    const route = getRouteWith(stubGetHost({ exists: false }).host, service)
    const res = fakeStreamRes()
    await route.handler(
      fakePost(
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen36-35b', modelDirectory: MODEL_DIR } }),
      ),
      res,
    )
    const events = ndjsonEvents(res.chunks)
    const progress = events.filter((event) => event.progress !== undefined)
    // The folded tqdm line lands as one progress event with the parsed state
    // the card renders.
    expect(progress).toHaveLength(1)
    expect(progress[0]?.progress).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
    // TASK-005: the answer carries no log lines. The run's plain text
    // reaches the card through the run-log hub (no matching provider entry,
    // so the engine-id key), and the persisted run stays plain text: the log
    // file reads the run, not the NDJSON it streamed.
    expect(events.some((event) => event.log !== undefined)).toBe(false)
    const hubText = service.readRunLog('ninfer').text
    expect(hubText).toContain('$ hf download')
    expect(hubText).toContain('get complete')
    expect(readConfig().lastLogs).toContain('$ hf download')
    expect(readConfig().lastLogs).not.toContain('{"log"')
  })

  it('answers 400 for a broken body and streams nothing', async () => {
    const route = getRouteWith(stubGetHost({ exists: false }).host)
    const res = fakeStreamRes()
    await route.handler(fakePost('{broken'), res)
    expect(res.status).toBe(400)
    expect(res.chunks).toHaveLength(0)
  })

  it('persists the failure note on the run-log hub and the last logs when the run throws', async () => {
    writeConfig('ninfer', {}, true)
    const throwingHost: LifecycleHost = {
      async run(): Promise<{ ok: boolean; detail?: string }> {
        throw new Error('host exploded')
      },
    }
    const service = stubService([])
    const route = getRouteWith(throwingHost, service)
    const res = fakeStreamRes()
    await route.handler(fakePost(JSON.stringify({ engine: 'ninfer' })), res)
    expect(res.status).toBe(200)
    // TASK-005: the failure note no longer rides the answer. The live hub
    // buffer and the persisted last logs carry it for the Logs section.
    expect(res.chunks.join('')).not.toContain('get failed: host exploded')
    expect(service.readRunLog('ninfer').text).toContain('get failed: host exploded')
    expect(readConfig().lastLogs).toContain('get failed: host exploded')
  })

  it('aborts the in-flight download on a client disconnect and persists the Canceled line', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the download step runs.
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
    const route = getRouteWith(stubGetHost({ exists: false }).host, service)
    const res = fakeStreamRes()
    const pending = route.handler(
      fakePost(
        JSON.stringify({
          engine: 'ninfer',
          config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        }),
      ),
      res,
    )
    // Let the handler reach the hanging download, then the card's provider-form
    // Cancel closes the stream: the route aborts the in-flight download, and
    // the run persists with the "Canceled" line.
    await new Promise((resolve) => setTimeout(resolve, 50))
    res.closeListeners[0]?.()
    await pending
    expect(readConfig().lastLogs).toContain('--- Canceled')
    // The run's own log file (the model slug names it) carries the same line,
    // so a reload reads the run as canceled, not as a fresh "Getting engine
    // and model..." run.
    const logDir = join(home, '.dsh', 'local-infer', 'logs')
    const entries = existsSync(logDir) ? readdirSync(logDir) : []
    const logFile = entries.find(
      (name) => name.startsWith('ninfer-qwen3-27b-') && name.endsWith('.log'),
    )
    expect(logFile).toBeDefined()
    expect(readFileSync(join(logDir, logFile!), 'utf8')).toContain('--- Canceled')
  })
})

describe('shared Get-steps routine', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-get-steps-'))
    pointHomeAt(home)
    // A sibling describe's afterAll removes the shared model directory, so
    // recreate it: the presence-skip tests write artifact files into it.
    mkdirSync(MODEL_DIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('runs all five Get steps in order and streams each through the log', async () => {
    // The model and template artifacts start absent, so the download steps
    // run for this test.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    rmSync(join(MODEL_DIR, 'chat_template.jinja'), { force: true })
    writeConfig(
      'ninfer',
      {
        model: 'qwen3-27b',
        chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
        modelDirectory: MODEL_DIR,
      },
      true,
    )
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const templates: { repo: string; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], {
      deps: [TEST_DEP],
      onDownload: (args) => downloads.push(args),
      onDownloadChatTemplate: (args) => templates.push(args),
    })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      {
        engine: 'ninfer',
        config: {
          model: 'qwen3-27b',
          chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The five steps land in order: the dep install, the clone (its header
    // then the git command), the build (its header then the cmake command),
    // the model download, and the chat-template download.
    const order = [
      'system dependencies (local)',
      '$ sudo apt install cmake',
      '  cmake: satisfied',
      'engine clone: ninfer',
      `$ git clone https://github.com/Neroued/ninfer ${dshEngineCacheDirectory('ninfer')}`,
      'engine build: ninfer',
      `cmake -S ${dshEngineCacheDirectory('ninfer')}`,
      `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir ${MODEL_DIR}`,
      `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir ${MODEL_DIR}`,
    ]
    let last = -1
    for (const line of order) {
      const index = logged.indexOf(line)
      expect(index, `missing "${line}" in the Get log`).toBeGreaterThan(last)
      last = index
    }
    // Each download's `$ <command>` audit line lands exactly once per run:
    // the service's exec site writes it, and no Get step repeats it.
    expect(
      logged.split('$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer').length - 1,
    ).toBe(1)
    expect(
      logged.split('$ hf download froggeric/Qwen-Fixed-Chat-Templates').length - 1,
    ).toBe(1)
    // The install command's audit line likewise appears once, ahead of the
    // re-check result the Get step logs.
    expect(logged.split('$ sudo apt install cmake').length - 1).toBe(1)
    // The downloads run through the service's hf download entry points, into
    // the model directory.
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.directory).toBe(MODEL_DIR)
    expect(templates).toEqual([
      { repo: 'froggeric/Qwen-Fixed-Chat-Templates', directory: MODEL_DIR, useHubCache: false },
    ])
    expect(logged).toContain('get complete')
  })

  it('downloads into the hub-cache layout when the model directory is the default', async () => {
    // No modelDirectory override: the hub-cache layout applies, so the
    // download targets the cache root (no --local-dir) and leaves no duplicate
    // flat dir. (Resume is within-invocation only; a killed run re-downloads.)
    writeConfig('ninfer', { model: 'qwen3-27b' }, true)
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownload: (args) => downloads.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b' } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The hub-cache command drops --local-dir, and with nothing cached yet
    // the model directory falls back to the hub cache root read through the
    // service seam (the plugin's model download home), not a flat subdir.
    expect(logged).toContain(
      '$ hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --format human\n',
    )
    expect(logged).not.toContain('--local-dir')
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.directory).toBe(MODEL_DIR)
    expect(logged).toContain('get complete')
  })

  it('skips the model download when the hub-cache artifact is already cached', async () => {
    // No modelDirectory override and the artifact present in the fake hub
    // cache under the service's model directory: the deterministic snapshot
    // presence check skips the re-fetch, and the layout stays hub-cache (no
    // --local-dir). The directory the steps would name (the hf download
    // result, the snapshot holding the artifact) is displayed by the summary,
    // never persisted into the config.
    const hubRoot = MODEL_DIR
    const snapshot = join(
      hubRoot,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    try {
      writeConfig('ninfer', { model: 'qwen3-27b' }, true)
      const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
      const service = stubService([], { onDownload: (args) => downloads.push(args) })
      const { host } = stubGetHost({ exists: false })
      let logged = ''
      const result = await getEngine(
        service,
        { engine: 'ninfer', config: { model: 'qwen3-27b' } },
        (chunk) => {
          logged += chunk
        },
        host,
      )
      expect(result.ok).toBe(true)
      expect(logged).not.toContain('--local-dir')
      expect(logged).toContain('model download: qwen3-27b is already present, skipped')
      expect(downloads).toHaveLength(0)
    } finally {
      rmSync(join(hubRoot, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('skips the model download when the artifact is already present', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'present')
    const downloads: { entry: DefaultModel; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownload: (args) => downloads.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The artifact is on disk, so no download runs and the step logs the
    // skip, not a re-fetch.
    expect(downloads).toHaveLength(0)
    expect(logged).toContain('model download: qwen3-27b is already present, skipped')
    expect(logged).not.toContain('hf download neroued')
    expect(logged).toContain('get complete')
  })

  it('skips the chat template download when the template is already present', async () => {
    writeConfig(
      'ninfer',
      {
        model: 'qwen3-27b',
        chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
        modelDirectory: MODEL_DIR,
      },
      true,
    )
    writeFileSync(join(MODEL_DIR, 'chat_template.jinja'), 'present')
    const templates: { repo: string; directory: string; useHubCache: boolean }[] = []
    const service = stubService([], { onDownloadChatTemplate: (args) => templates.push(args) })
    const { host } = stubGetHost({ exists: false })
    let logged = ''
    const result = await getEngine(
      service,
      {
        engine: 'ninfer',
        config: {
          model: 'qwen3-27b',
          chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates',
          modelDirectory: MODEL_DIR,
        },
      },
      (chunk) => {
        logged += chunk
      },
      host,
    )
    expect(result.ok).toBe(true)
    // The template file is on disk, so no download runs and the step logs
    // the skip, not a re-fetch.
    expect(templates).toHaveLength(0)
    expect(logged).toContain(
      'chat template: froggeric/Qwen-Fixed-Chat-Templates is already present, skipped',
    )
    expect(logged).toContain('get complete')
  })

  it('skips the sync and build steps when auto rebuild is off', async () => {
    writeConfig('ninfer', {}, true)
    const service = stubService([])
    const { host, state } = stubGetHost({ exists: false })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: {},
        allowRunDeps: true,
        autoRebuild: false,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    // The checkbox off: the checkout launches as-is, so no git sync and no
    // build run.
    expect(logged).toContain('engine sync and build: auto rebuild off, skipped')
    expect(state.streamed.some((command) => command.includes('git'))).toBe(false)
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
  })

  it('aborts a launch when a Get step fails and keeps the Get logs', async () => {
    writeConfig('ninfer', { buildMode: 'local' }, false)
    const service = stubService([], {
      deps: [TEST_DEP],
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          port: 18020,
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { buildMode: 'local' } },
      undefined,
      stubGetHost({ exists: false }).host,
    )
    // The missing dep aborts the launch before the deploy starts, and the
    // persisted run carries the Get-step output that named the broken step.
    expect(result.healthy).toBe(false)
    expect(result.detail).toBe('a system dependency is missing')
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('  cmake: missing')
    expect(lastLogs).toContain('a system dependency is missing')
    // The get-failed path leaves the result's logs unset, so the persisted
    // run leads with the Get-step output and carries it exactly once.
    expect(lastLogs.match(/a system dependency is missing/g)?.length).toBe(1)
  })

  it('continues with the current version when a rebase fails under the override', async () => {
    // The checkout directory exists (a current version to launch), so a failed
    // rebase is non-fatal under the override: the run reports syncFailed and
    // skips the build, keeping the checkout at its current version.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    const service = stubService([])
    const { host, state } = stubGetHost({ exists: true, fail: ['rebase'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        continueOnSyncFailure: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.syncFailed).toBe(true)
    // The error line and the continue note land in the logs the caller
    // persists to the Logs section and the log file.
    expect(logged).toContain('!! git rebase')
    expect(logged).toContain('engine sync failed; continuing with the current version')
    expect(logged).toContain('get complete')
    // The rebase failed, so the build step is skipped: no cmake command runs.
    expect(state.streamed.some((command) => command.includes('cmake'))).toBe(false)
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('still fails the run when a rebase fails without the override', async () => {
    // The override off (a standalone Get): a failed rebase of an existing
    // checkout stops the run, the existing behavior.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    const service = stubService([])
    const { host } = stubGetHost({ exists: true, fail: ['rebase'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.syncFailed).toBeUndefined()
    expect(result.detail).toContain('git rebase')
    expect(logged).toContain('!! git rebase')
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('keeps a clone failure fatal under the override when no checkout exists', async () => {
    // No checkout directory (a clone failure, no current version to launch):
    // the override does not apply, so the run stays fatal.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
    const service = stubService([])
    const { host } = stubGetHost({ exists: false, fail: ['git clone'] })
    let logged = ''
    const result = await runGetSteps(
      service,
      {
        engineId: 'ninfer',
        config: { modelDirectory: MODEL_DIR },
        allowRunDeps: true,
        continueOnSyncFailure: true,
        host,
      },
      (chunk) => {
        logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.syncFailed).toBeUndefined()
    expect(result.detail).toContain('git clone')
    expect(logged).toContain('!! git clone')
  })
})

describe('engine death persistence', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-death-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function providerWithRecord(): StoredProviderConfig {
    return {
      id: 'p1',
      engine: 'infernix',
      config: { port: 18080 },
      platform: {},
      launch: {
        pid: 12345,
        startedAt: '2026-10-23T12:00:00.000Z',
        argv: ['infernix-serve', '--port', '18080'],
        previousPids: [999],
        engineId: 'infernix',
        modelId: 'qwen3-27b',
        port: 18080,
      },
    }
  }

  it('clears the provider record and notes the exit when the engine is killed', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithRecord()],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    handleEngineDeath({
      engineId: 'infernix',
      port: 18080,
      pid: 12345,
      code: null,
      signal: 'SIGKILL',
    })
    const stored = readConfig()
    // The record (with its previous-pid list) is gone, so a restart cannot
    // re-link the recycled pid, and the exit line landed in the last-run logs.
    expect(stored.providers[0]?.launch).toBeUndefined()
    expect(stored.lastLogs).toContain('engine up')
    expect(stored.lastLogs).toContain(
      'engine infernix (port 18080) pid 12345 exited on signal SIGKILL',
    )
  })

  it('matches by engine and port when the death carries no tracked pid', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [providerWithRecord()],
      DEFAULT_LOG_PATH_TEMPLATE,
      '',
    )
    handleEngineDeath({
      engineId: 'infernix',
      port: 18080,
      code: 1,
      signal: null,
      detail: 'the adopted engine process exited outside this DSH session',
    })
    const stored = readConfig()
    expect(stored.providers[0]?.launch).toBeUndefined()
    expect(stored.lastLogs).toContain('exited with exit code 1')
    expect(stored.lastLogs).toContain('outside this DSH session')
  })

  it('stays quiet when no stored entry carries a matching record', () => {
    writeConfig(
      'infernix',
      {},
      false,
      undefined,
      true,
      [{ id: 'p2', engine: 'infernix', config: {}, platform: {} }],
      DEFAULT_LOG_PATH_TEMPLATE,
      'keep',
    )
    handleEngineDeath({ engineId: 'infernix', port: 9999, pid: 777, code: null, signal: null })
    // An expected stop (the route already cleared the record) or an untracked
    // engine rewrites nothing: the stored state stays as the stop left it.
    expect(readConfig().lastLogs).toBe('keep')
    expect(readConfig().providers[0]?.launch).toBeUndefined()
  })

  it('mount registers the death observer and dispose clears it', () => {
    let observer: ((event: EngineDeathEvent) => void) | undefined = 'unset' as never
    let dispose: (() => void) | undefined
    const scope = {
      webServer: {
        register: (): (() => void) => () => undefined,
      },
      effect: (fn: () => unknown): void => {
        dispose = fn() as () => void
      },
    }
    registerLocalInferRoute(
      scope as unknown as import('@deepseek-ai/cordis').Context & {
        webServer: import('../src/route.ts').WebServerService
      },
      stubService([], {
        onSetDeathObserver: (next): void => {
          observer = next
        },
      }),
    )
    expect(observer).toBeTypeOf('function')
    dispose?.()
    expect(observer).toBeUndefined()
  })

  it('passes the provider config into the status detector', async () => {
    let refs: readonly ProviderRef[] | undefined
    writeConfig('ninfer', {}, false, undefined, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b', port: 18080 }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async (providers) => {
        refs = providers
        return {}
      },
    })
    await buildSummary(service)
    // The config rides into the detector so the signature prices the
    // provider's own port rather than the adapter's default.
    expect(refs?.[0]?.config).toEqual({ model: 'qwen3-27b', port: 18080 })
  })
})
