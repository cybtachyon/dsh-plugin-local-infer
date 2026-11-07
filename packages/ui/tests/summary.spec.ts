/**
 * The summary read model over the stub service: the route read model
 * (config round trip, help toggle, defaults provenance), the model defaults,
 * status, and download read model, the provider list round trip, and the VRAM
 * estimator on the sane default configs. (Split from route.spec.ts by describe,
 * TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Config, DefaultModel, ProviderStatus } from 'dsh-plugin-local-infer/core'
import { DEFAULT_LOG_PATH_TEMPLATE } from 'dsh-plugin-local-infer/core'
import { LocalInfer } from 'dsh-plugin-local-infer/service'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { apply as applyProviders } from 'dsh-plugin-local-infer/providers'
import { localInferConfigPath, readConfig, writeConfig } from '../src/config.ts'
import { downloadFor } from '../src/ops/hf.ts'
import { registerLocalInferRoute, RouteError } from '../src/route.ts'
import { buildSummary } from '../src/viewmodels/summary.ts'
import { BREAKDOWN, FIRED, FITS, HW, MODEL_DIR, pointHomeAt, stubService } from './fixtures.ts'

describe('local-infer route read model', () => {
  let home: string

  beforeAll(() => {
    // readConfig and writeConfig key the config file on homedir(), so the
    // suite points HOME at a scratch dir and never touches the real one.
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('prices the meter and fires the guideline warnings in one summary', async () => {
    const summary = await buildSummary(stubService(FIRED), { engine: 'ninfer', config: {} })
    expect(summary.engineId).toBe('ninfer')
    expect(summary.verdict).toEqual(FITS)
    expect(summary.meterModel.largestFittingContext).toBe(8192)
    expect(summary.warningsModel.banner.visible).toBe(true)
    expect(summary.warningsModel.banner.level).toBe('error')
    expect(summary.warningsModel.banner.count).toBe(1)
    // The summary carries the resolved defaults model the card draws from.
    expect(summary.defaults).toBeDefined()
    expect(summary.defaults.provenance).toEqual([])
    expect(summary.warningsModel.inline['kvDtype']).toHaveLength(1)
    expect(summary.warningsModel.inline['kvDtype']?.[0]?.tone).toBe('red')
  })

  it('reads the banner as hidden when no guideline fired', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'hyperqwen', config: {} })
    expect(summary.engineId).toBe('hyperqwen')
    expect(summary.warningsModel.banner.visible).toBe(false)
    expect(Object.keys(summary.warningsModel.inline)).toEqual([])
  })

  it('falls back to the first engine when the request names none', async () => {
    const summary = await buildSummary(stubService([]), undefined)
    expect(summary.engineId).toBe('ninfer')
  })

  it('rides the estimate reserve source into the meter model', async () => {
    // The meter's reserve readout names where the dark segment came from, so
    // the summary must carry the estimate's reserveSource, not a constant.
    const service: LocalInferService = {
      ...stubService([]),
      estimate: async () => ({
        breakdown: BREAKDOWN,
        verdict: FITS,
        source: 'measured',
        reserveSource: 'foreign-process',
      }),
    }
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.reserveSource).toBe('foreign-process')
    // The stub service's default source rides through when the estimate
    // carries none of the dynamic sources.
    const defaulted = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(defaulted.meterModel.reserveSource).toBe('default')
  })

  it('round-trips the stored config through the file the CLI shares', () => {
    const config: Config = { maxContext: 65536 }
    writeConfig('ninfer', config, true)
    expect(localInferConfigPath()).toBe(join(home, '.dsh', 'local-infer', 'config.json'))
    expect(readConfig()).toEqual({
      engine: 'ninfer',
      config,
      allowRunDeps: true,
      platform: {},
      showHelp: true,
      providers: [],
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
    })
  })

  it('reads a missing config file as the scaffold default with the gate off', () => {
    // The round-trip above wrote the file, so clear it for this assertion.
    rmSync(localInferConfigPath())
    expect(readConfig()).toEqual({
      engine: 'ninfer',
      config: {},
      allowRunDeps: false,
      platform: {},
      showHelp: true,
      providers: [],
      logPath: DEFAULT_LOG_PATH_TEMPLATE,
      lastLogs: '',
    })
  })

  it('round-trips the help toggle and reads a missing key as visible', () => {
    writeConfig('ninfer', {}, false, undefined, false)
    expect(readConfig().showHelp).toBe(false)
    // A file that predates the key reads as descriptions visible, the
    // default the card draws on first open.
    const path = localInferConfigPath()
    writeFileSync(path, JSON.stringify({ engine: 'ninfer', config: {}, allowRunDeps: false }))
    expect(readConfig().showHelp).toBe(true)
  })

  it('exposes the stored help toggle in the summary', async () => {
    writeConfig('ninfer', {}, false, undefined, false)
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.showHelp).toBe(false)
  })
})

describe('model defaults, status, and download read model', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-models-route-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(MODEL_DIR, { recursive: true, force: true })
  })

  it('seeds the summary with the model directory and the engine default models', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.modelDirectory).toBe(MODEL_DIR)
    expect(summary.modelDefaults).toEqual([
      {
        id: 'qwen3-27b',
        label: 'Ninfer Qwen3.8-27B',
        url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      },
      {
        id: 'qwen3-27b-swift15',
        label: 'Ninfer Qwen3.8-27B (Swift 1.5)',
        url: 'https://huggingface.co/kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
      },
      {
        id: 'qwen36-35b',
        label: 'Ninfer Qwen3.6-35B',
        url: 'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      },
    ])
    // Strata carries the two models the README links, so the summary seeds
    // them and the status resolves the first default (Gyro).
    const strata = await buildSummary(stubService([]), { engine: 'strata', config: {} })
    expect(strata.modelDefaults.map((entry) => entry.id)).toEqual(['gyro-s', 'ist-das-2.00bpw'])
    expect(strata.modelStatus?.modelId).toBe('gyro-s')
  })

  it('leaves the config model directory unset when the user named none', async () => {
    // No backfill: the config the card edits carries no modelDirectory key,
    // so a Save of a default install never stores a fake override. The
    // display value still names the hub cache root (nothing is cached).
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.config.modelDirectory).toBeUndefined()
    expect(summary.modelDirectory).toBe(MODEL_DIR)
  })

  it('shows the hub-cache snapshot directory when the artifact is cached', async () => {
    // No override and the artifact present in the fake hub cache under the
    // stub's default directory: the displayed model directory is the
    // snapshot holding it (the hf download result), never the hub root and
    // never persisted back into the config.
    const snapshot = join(
      MODEL_DIR,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    try {
      const summary = await buildSummary(stubService([]), {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
      })
      expect(summary.modelDirectory).toBe(snapshot)
      expect(summary.config.modelDirectory).toBeUndefined()
      // The layout stays the hub cache (the command carries no --local-dir).
      expect(summary.modelStatus?.downloadCommand).not.toContain('--local-dir')
    } finally {
      rmSync(join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('keeps a user-named directory over the default', async () => {
    const summary = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { modelDirectory: '/custom/models' },
    })
    expect(summary.config.modelDirectory).toBe('/custom/models')
    expect(summary.modelDirectory).toBe('/custom/models')
    expect(summary.modelStatus?.downloadCommand).toContain('--local-dir /custom/models')
  })

  it('reads an absent model as the no-CLI row with the download command', async () => {
    // No modelDirectory override means the hub-cache layout: the command
    // carries no --local-dir, so the hf CLI writes into the hub cache (the
    // raw config decides the layout, never a backfilled default).
    const summary = await buildSummary(stubService([], { hfCliPath: null }), {
      engine: 'ninfer',
      config: {},
    })
    expect(summary.modelStatus).toEqual({
      modelId: 'qwen3-27b',
      label: 'Ninfer Qwen3.8-27B',
      url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      present: false,
      hfCli: false,
      downloadCommand: `hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --format human`,
    })
  })

  it('carries the chat-template status for an HF repo reference, null for a local path', async () => {
    const withTemplate = await buildSummary(stubService([], { hfCliPath: '/usr/bin/hf' }), {
      engine: 'ninfer',
      config: { chatTemplate: 'froggeric/Qwen-Fixed-Chat-Templates' },
    })
    // No modelDirectory override means the hub-cache layout: the command
    // carries no --local-dir (the raw config decides the layout).
    expect(withTemplate.chatTemplateStatus).toEqual({
      repo: 'froggeric/Qwen-Fixed-Chat-Templates',
      label: 'Froggeric22 (Qwen fixed chat templates)',
      present: false,
      hfCli: true,
      downloadCommand: `hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --format human`,
    })

    // A local path is not an HF repo reference, so the status reads as null.
    const withPath = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { chatTemplate: '/models/chat_template.jinja' },
    })
    expect(withPath.chatTemplateStatus).toBeNull()

    // No template selected reads as null too.
    const noTemplate = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(noTemplate.chatTemplateStatus).toBeNull()
  })

  it('reports the hf CLI detected when the probe finds it', async () => {
    const summary = await buildSummary(stubService([], { hfCliPath: '/usr/local/bin/hf' }), {
      engine: 'ninfer',
      config: {},
    })
    expect(summary.modelStatus?.hfCli).toBe(true)
  })

  it('reads the model as present when its artifact file is in the directory', async () => {
    // An explicit directory override keeps the flat layout: the presence
    // check looks for the artifact file in it directly.
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'weights')
    const summary = await buildSummary(stubService([]), {
      engine: 'ninfer',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(summary.modelStatus?.present).toBe(true)
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'))
  })

  it('reads the model as present through the hub-cache snapshot when no override names one', async () => {
    // The default (no override) resolves presence through the deterministic
    // hub-cache snapshot pick: a bare blobs folder left by any download no
    // longer reads as present on its own.
    const modelRoot = join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer')
    mkdirSync(join(modelRoot, 'blobs'), { recursive: true })
    try {
      const bare = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
      expect(bare.modelStatus?.present).toBe(false)
      const snapshot = join(modelRoot, 'snapshots', 'cafebabe1234567890')
      mkdirSync(snapshot, { recursive: true })
      writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
      const cached = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
      expect(cached.modelStatus?.present).toBe(true)
    } finally {
      rmSync(modelRoot, { recursive: true, force: true })
    }
  })

  it('resolves the download through the service with the request directory', async () => {
    let seen: { entry: DefaultModel; directory: string; useHubCache: boolean } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    const result = await downloadFor(service, {
      engine: 'ninfer',
      model: 'qwen36-35b',
      directory: '/custom/models',
    })
    expect(result).toEqual({ ok: true })
    expect(seen?.entry?.url).toBe('https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer')
    expect(seen?.directory).toBe('/custom/models')
    // A request-named directory keeps the flat --local-dir layout.
    expect(seen?.useHubCache).toBe(false)
  })

  it('falls back to the stored config directory and model when the request names none', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: '/stored/models' }, false)
    let seen: { entry: DefaultModel; directory: string; useHubCache: boolean } | undefined
    const service = stubService([], {
      onDownload: (args) => {
        seen = args
      },
    })
    await downloadFor(service, {})
    expect(seen?.entry?.modelId).toBe('qwen3-27b')
    expect(seen?.directory).toBe('/stored/models')
    // A stored-config directory keeps the flat --local-dir layout too.
    expect(seen?.useHubCache).toBe(false)
  })

  it('follows the request, stored, and hub-cache precedence with the artifact cached', async () => {
    // The three levels in one run, with the artifact already cached in the
    // fake hub cache: a cached artifact never turns the download base into
    // the resolved snapshot directory (the hf CLI resolves its own snapshot
    // destination), so the route keeps the hub cache root as the base.
    const snapshot = join(
      MODEL_DIR,
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
      'snapshots',
      'cafebabe1234567890',
    )
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: '/stored/models' }, false)
    const seen: { directory: string; useHubCache: boolean }[] = []
    const service = stubService([], {
      onDownload: (args) => {
        seen.push({ directory: args.directory, useHubCache: args.useHubCache })
      },
    })
    try {
      // Level 1: the request directory wins over the stored config.
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b', directory: '/req/models' })
      // Level 2: the stored config wins over the hub cache root.
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b' })
      // Level 3: neither names one, so the hub cache root is the base and the
      // hub-cache layout applies (no --local-dir; the hf CLI picks the snapshot).
      writeConfig('ninfer', { model: 'qwen3-27b' }, false)
      await downloadFor(service, { engine: 'ninfer', model: 'qwen3-27b' })
      expect(seen).toEqual([
        { directory: '/req/models', useHubCache: false },
        { directory: '/stored/models', useHubCache: false },
        { directory: MODEL_DIR, useHubCache: true },
      ])
    } finally {
      rmSync(join(MODEL_DIR, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer'), {
        recursive: true,
        force: true,
      })
    }
  })

  it('refuses a download for a model no default names with a 404', async () => {
    await expect(downloadFor(stubService([]), { engine: 'strata', model: 'qwen3-27b' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })

  it('persists the download run under the "Downloading..." separator', async () => {
    writeConfig('ninfer', { model: 'qwen36-35b', modelDirectory: MODEL_DIR }, false)
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
      stubService([]),
    )
    const route = routes.find((r) => r.path === '/local-infer/download')!
    const res = {
      status: 0,
      body: '' as string,
      writeHead(status: number): unknown {
        res.status = status
        return res
      },
      end(body?: string): unknown {
        res.body = body ?? ''
        return res
      },
    }
    await route.handler(
      {
        method: 'POST',
        url: '/local-infer/download',
        destroy(): void {
          /* the handler only destroys on an oversize body */
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
          yield Buffer.from(
            JSON.stringify({ engine: 'ninfer', model: 'qwen36-35b', directory: MODEL_DIR }),
          )
        },
      },
      res,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    // The download run persists under the "Downloading..." separator, so the
    // Logs section and the log file show the download beside the Get and launch
    // runs.
    expect(readConfig().lastLogs).toContain('--- Downloading...')
    expect(readConfig().lastLogs).toContain('download complete')
  })

  it('seeds the summary with the directory-scanned model files for the engine', async () => {
    // A modelDirectory override keeps the flat layout, so the scan lists the
    // directory entries through listModelDirectory (the hub-cache scan is the
    // default case, served by listModelCache).
    const service = stubService([], {
      modelEntries: [
        { name: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer', isDirectory: false },
        { name: 'Qwen3.8-27B-Q4_K_M.gguf', isDirectory: false },
        { name: 'Qwen3.8-27B-W4A16-AutoRound-fast', isDirectory: true, hasSafetensors: true },
        { name: 'froggeric_Qwen-Fixed-Chat-Templates', isDirectory: true, hasSafetensors: false },
      ],
    })
    const ninfer = await buildSummary(service, {
      engine: 'ninfer',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(ninfer.modelFiles).toEqual([
      'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    ])
    const llamacpp = await buildSummary(service, {
      engine: 'llamacpp',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(llamacpp.modelFiles).toEqual(['Qwen3.8-27B-Q4_K_M.gguf'])
    const hyperqwen = await buildSummary(service, {
      engine: 'hyperqwen',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(hyperqwen.modelFiles).toEqual(['Qwen3.8-27B-W4A16-AutoRound-fast'])
    // Strata offers no dense-Qwen model, so the scan reads as empty.
    const strata = await buildSummary(service, {
      engine: 'strata',
      config: { modelDirectory: MODEL_DIR },
    })
    expect(strata.modelFiles).toEqual([])
  })
})

describe('provider list round trip', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-prov-'))
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

  const find = (
    list: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[],
    path: string,
  ) => list.find((route) => route.path === path)!

  it('lists the saved providers with their statuses in the summary', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
        { id: 'p2', engine: 'hyperqwen', config: { model: 'qwen3-35b' }, platform: {} },
      ],
    )
    const service = stubService([], {
      providerStatuses: async (providers) => {
        const statuses: Record<string, ProviderStatus> = {}
        for (const provider of providers) {
          statuses[provider.id] = provider.id === 'p1' ? 'running' : 'unsure'
        }
        return statuses
      },
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.providers).toEqual([
      {
        id: 'p1',
        engine: 'ninfer',
        model: 'qwen3-27b',
        status: 'running',
        config: { model: 'qwen3-27b' },
        platform: {},
      },
      {
        id: 'p2',
        engine: 'hyperqwen',
        model: 'qwen3-35b',
        status: 'unsure',
        config: { model: 'qwen3-35b' },
        platform: {},
      },
    ])
  })

  it('re-links recorded providers in the summary and clears the dead records', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
      {
        id: 'p2',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 54321,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18021,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const reLinked: string[] = []
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'running', p2: 'stopped' }),
      reLinkProviders: async (entries) => {
        reLinked.push(...entries.map((entry) => entry.id))
        return { p1: 'adopted', p2: 'dead' }
      },
    })
    await buildSummary(service, { engine: 'ninfer', config: {} })
    // The summary prices every recorded provider through the re-link, and a
    // dead engine clears its record (the previous-pid list with it) so a
    // recycled pid cannot re-link.
    expect(reLinked).toEqual(['p1', 'p2'])
    const stored = readConfig()
    expect(stored.providers[0]?.launch?.pid).toBe(12345)
    expect(stored.providers[1]?.launch).toBeUndefined()
  })

  it('sets the Unknown Engine(s) readout when a provider reads as unsure', async () => {
    // A foreign engine the detector saw but could not tie to a model reads as
    // unsure, so the meter's "Unknown Engine(s)" section names the VRAM those
    // programs are holding (the OS-reserve segment, the GPU's used VRAM).
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'unsure' }),
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.unknownEngines).toEqual({ bytes: 10 })
  })

  it('omits the Unknown Engine(s) readout when no provider reads as unsure', async () => {
    // A confirmed-running provider (or no providers at all) means no foreign
    // engine, so the section stays out of the meter.
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      providerStatuses: async () => ({ p1: 'running' }),
    })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.unknownEngines).toBeNull()
  })

  it('adds a new provider entry at the top of the list on a save without an id', async () => {
    // Clear the file the earlier test wrote, so a fresh save starts from an
    // empty list and the new entry is the only one.
    rmSync(localInferConfigPath(), { force: true })
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq('POST', '/local-infer/save', JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b' } })),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.engine).toBe('ninfer')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-27b' })
    // The minted id is a non-blank string the card can edit and delete against.
    expect(typeof stored.providers[0]?.id).toBe('string')
    expect(stored.providers[0]?.id.trim()).not.toBe('')
  })

  it('keeps the provider list intact on a settings-only save', async () => {
    // The help and allow-run toggles persist the global fields through the
    // save route with settingsOnly set. That must not mint a new entry, so a
    // toggle never duplicates the list the way an id-less save used to.
    rmSync(localInferConfigPath(), { force: true })
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: false, settingsOnly: true }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // The toggle persists, and the single stored entry survives untouched:
    // no minted id, no prepended duplicate.
    expect(stored.showHelp).toBe(false)
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    // A second settings-only save keeps the list at one entry, so repeated
    // toggles do not accumulate duplicates.
    const again = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: {}, showHelp: true, settingsOnly: true }),
      ),
      again,
    )
    expect(again.status).toBe(200)
    expect(readConfig().providers).toHaveLength(1)
    expect(readConfig().providers[0]?.id).toBe('p1')
  })

  it('updates a stored provider in place when a save carries its id', async () => {
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ id: 'p1', engine: 'ninfer', config: { model: 'qwen3-35b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
  })

  it('updates a matching stored provider in place on an id-less save (no duplicate)', async () => {
    // A "New provider" save that matches a stored entry (the same engine,
    // config, and platform) updates it in place instead of minting a
    // duplicate, so a "New provider" then Save without a change never
    // prepends a second copy of the same provider.
    rmSync(localInferConfigPath(), { force: true })
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-27b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // The matching entry is updated in place (its id is kept), not duplicated.
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p1')
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-27b' })
  })

  it('mints a new entry on an id-less save that matches no stored provider', async () => {
    rmSync(localInferConfigPath(), { force: true })
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ engine: 'ninfer', config: { model: 'qwen3-35b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    // A different config does not match the stored entry, so a new id is
    // minted and the entry is prepended.
    expect(stored.providers).toHaveLength(2)
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
    expect(stored.providers[0]?.id).not.toBe('p1')
    expect(stored.providers[1]?.id).toBe('p1')
  })

  it('carries the launch record over when a save updates the entry in place', async () => {
    // Editing a running provider's config must not drop the record the
    // restart re-link prices, so the save keeps the entry's launch record.
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      {
        id: 'p1',
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        platform: {},
        launch: {
          pid: 12345,
          startedAt: '2026-10-14T12:00:00.000Z',
          argv: ['ninfer-serve'],
          parentPid: 999,
          previousPids: [999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const service = stubService([])
    const list = routes(service)
    const save = find(list, '/local-infer/save')
    const res = fakeRes()
    await save.handler(
      fakeReq(
        'POST',
        '/local-infer/save',
        JSON.stringify({ id: 'p1', engine: 'ninfer', config: { model: 'qwen3-35b' } }),
      ),
      res,
    )
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers[0]?.config).toEqual({ model: 'qwen3-35b' })
    expect(stored.providers[0]?.launch?.pid).toBe(12345)
  })

  it('removes a provider by id through the delete route', async () => {
    const service = stubService([])
    const list = routes(service)
    const del = find(list, '/local-infer/provider-delete')
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
      { id: 'p2', engine: 'hyperqwen', config: { model: 'qwen3-35b' }, platform: {} },
    ])
    const res = fakeRes()
    await del.handler(fakeReq('POST', '/local-infer/provider-delete', JSON.stringify({ id: 'p1' })), res)
    expect(res.status).toBe(200)
    const stored = readConfig()
    expect(stored.providers).toHaveLength(1)
    expect(stored.providers[0]?.id).toBe('p2')
  })

  it('answers 400 when the delete route is given no id', async () => {
    const service = stubService([])
    const list = routes(service)
    const del = find(list, '/local-infer/provider-delete')
    const res = fakeRes()
    await del.handler(fakeReq('POST', '/local-infer/provider-delete', JSON.stringify({})), res)
    expect(res.status).toBe(400)
  })

  it('sets registered to true when modelIsRegistered returns true', async () => {
    const service = stubService([], { modelIsRegisteredResult: true })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.registered).toBe(true)
  })

  it('sets registered to false when modelIsRegistered returns false', async () => {
    const service = stubService([], { modelIsRegisteredResult: false })
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.registered).toBe(false)
  })
})

describe('VRAM estimator on the sane default configs', () => {
  // A real LocalInfer service with the NInfer measured VramModels registered,
  // so the estimate resolves a model the way the running plugin does. The
  // stub service prices a fixed breakdown, so it never exercises the model
  // resolution the empty-meter bug lives in. detectHardware is pinned to the
  // suite's 24 GiB card, so the meter prices a real budget without a live
  // nvidia-smi probe.
  class FixedHwLocalInfer extends LocalInfer {
    async detectHardware() {
      return HW
    }
  }

  async function realService() {
    const ctx = new Context()
    await ctx.plugin(FixedHwLocalInfer)
    // Register the NInfer measured VramModels, the built-in presets, and the
    // engine adapters, so the estimate resolves a real model and the defaults
    // resolver prices a sane budget (the preset's kvDtype and max-context).
    applyProviders(ctx)
    return ctx.localInfer
  }

  it('prices the default config (no model) against the engine first default model', async () => {
    const service = await realService()
    // The default config names no model, so the summary prices the engine's
    // first default model (qwen3-27b) rather than reading as not-measured.
    const summary = await buildSummary(service, { engine: 'ninfer', config: {} })
    expect(summary.meterModel.source).not.toBe('not-measured')
    expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
  })

  it('prices each registered NInfer default model so the chart renders', async () => {
    const service = await realService()
    // The NInfer default list names qwen3-27b and qwen3-27b-swift15, both of
    // which carry a measured VramModel, so each selection prices a real
    // budget and the meter's segments are non-zero.
    for (const modelId of ['qwen3-27b', 'qwen3-27b-swift15']) {
      const summary = await buildSummary(service, {
        engine: 'ninfer',
        config: { model: modelId },
      })
      expect(summary.meterModel.source).not.toBe('not-measured')
      expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
    }
  })

  it('prices a directory-scanned model file through its registry key', async () => {
    const service = await realService()
    // The card's Model field can carry an artifact file name from the
    // directory scan (a .ninfer file), not a registry key. The default list
    // maps that file to the registry key the estimator knows, so a scanned
    // model prices a real VramModel rather than reading as not-measured.
    const summary = await buildSummary(service, {
      engine: 'ninfer',
      config: { model: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer' },
    })
    expect(summary.meterModel.source).not.toBe('not-measured')
    expect(summary.meterModel.segments.some((segment) => segment.bytes > 0)).toBe(true)
  })
})
