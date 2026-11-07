/**
 * The launch and stop route helpers over the stub service (plan render,
 * progress phases, log persistence, compose args, sudo, cancel) and the
 * platform config (§3.10) round trip and launch pass-through. (Split from
 * route.spec.ts by describe, TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DefaultModel, EnginePlatformConfig, LaunchPlan } from 'dsh-plugin-local-infer/core'
import { DEFAULT_LOG_PATH_TEMPLATE, dshEngineCacheDirectory, resolveLogPath } from 'dsh-plugin-local-infer/core'
import type { LaunchResult } from 'dsh-plugin-local-infer/service'
import { localInferConfigPath, readConfig, writeConfig } from '../src/config.ts'
import { launchEngine, stopEngine } from '../src/ops/engine.ts'
import { RouteError } from '../src/route.ts'
import { buildSummary } from '../src/viewmodels/summary.ts'
import { MODEL_DIR, argvAdapter, fakeAdapter, pointHomeAt, stubGetHost, stubService } from './fixtures.ts'

describe('launch and stop route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-launch-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('renders the plan through the registered adapter and returns the launch answer', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(result.healthy).toBe(true)
    expect(result.plan.engineId).toBe('ninfer')
  })

  it('reports the real phase sequence and threads the progress sink to the service launch', async () => {
    // The trust gate is on, so the Get-steps dep install reports prereqs as it
    // starts; the sync/build step reports build as it runs; the route then
    // threads the same sink to the service launch, which reports the deploy
    // sub-steps.
    writeConfig('ninfer', { port: 18020 }, true)
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    // The stub service's launch records the sink the route threads and reports
    // the deploy sub-steps it would, so the test prices the full sequence the
    // card's button reads.
    let seenSink: ((step: 'prereqs' | 'download' | 'build' | 'launch') => void) | undefined
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      seenSink = options?.onProgress
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      (step) => {
        steps.push(step)
      },
      stubGetHost().host,
    )
    expect(typeof seenSink).toBe('function')
    // The Get-steps phases land first (the dep install's prereqs, then the
    // sync/build's build), then the sink rides to the service launch, which
    // reports the deploy sub-steps.
    expect(steps).toEqual(['prereqs', 'build', 'download', 'build'])
  })

  it('skips the prereqs phase when the trust gate is off', async () => {
    // The trust gate is off, so no system-dependency install runs and the
    // prereqs phase is not reported; the sequence starts at the sync/build
    // step and continues with the deploy steps.
    writeConfig('ninfer', { port: 18020 }, false)
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      options?.onProgress?.('download')
      options?.onProgress?.('build')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      (step) => {
        steps.push(step)
      },
      stubGetHost().host,
    )
    expect(steps).toEqual(['build', 'download', 'build'])
  })

  it('reports the real step order when the checkout and the model must be fetched', async () => {
    // The gate is on and the model artifact and the checkout are absent, so
    // the dep install, the sync/build, and the model download all actually
    // run: the steps announce their phases as their work starts, in the real
    // sequence prereqs -> build -> download, and the deploy reports launch.
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    mkdirSync(MODEL_DIR, { recursive: true })
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      // The deploy reports the health-poll phase as the real service does.
      options?.onProgress?.('launch')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      (step) => {
        steps.push(step)
      },
      stubGetHost({ exists: false }).host,
    )
    expect(steps).toEqual(['prereqs', 'build', 'download', 'launch'])
  })

  it('reports only the launch step when every Get step is already satisfied', async () => {
    // The gate is off (no install runs, the satisfied re-check announces
    // nothing), Auto Rebuild is off (no sync/build), and the model artifact
    // is on disk (no download): the only phase the run reports is the
    // deploy's health poll.
    writeConfig('ninfer', { model: 'qwen3-27b', modelDirectory: MODEL_DIR }, false)
    mkdirSync(MODEL_DIR, { recursive: true })
    writeFileSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), 'present')
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { onProgress?: (step: 'prereqs' | 'download' | 'build' | 'launch') => void }): Promise<LaunchResult> => {
      options?.onProgress?.('launch')
      return { plan, healthy: true }
    }
    const steps: string[] = []
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { model: 'qwen3-27b', modelDirectory: MODEL_DIR },
        autoRebuild: false,
      },
      (step) => {
        steps.push(step)
      },
      stubGetHost().host,
    )
    expect(steps).toEqual(['launch'])
  })

  it('threads the auto-rebuild flag to the service launch', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    // The checkbox off: the route passes the flag into the service launch
    // options, which the service threads to the deploy step, which skips the
    // git sync (fetch, rebase, rebuild).
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true }
    }
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 }, autoRebuild: false },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBe(false)
    // The flag absent: the route omits the key, so the deploy step runs the
    // rebuild.
    seenOptions = undefined
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBeUndefined()
  })

  it('launches the current version and skips the deploy git sync after a Get rebase failure', async () => {
    // The checkout directory exists (a current version to launch), so the
    // launch's Get-step rebase failure is non-fatal under the override the
    // launch always sets: the launch continues with the checkout's current
    // version.
    writeConfig('ninfer', { modelDirectory: MODEL_DIR }, true)
    mkdirSync(dshEngineCacheDirectory('ninfer'), { recursive: true })
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\n',
      },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true, logs: 'engine booted\n' }
    }
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { modelDirectory: MODEL_DIR }, autoRebuild: true },
      undefined,
      stubGetHost({ exists: true, fail: ['rebase'] }).host,
    )
    // The sync failed, so the deploy's own git sync (it would hit the same
    // rebase conflict) is skipped and the checkout's current version
    // launches.
    expect(result.healthy).toBe(true)
    expect(seenOptions?.autoRebuild).toBe(false)
    // The Get error line and the continue note persist under the
    // "Launching..." separator, so the Logs section names the broken
    // rebase after a reload.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('!! git rebase')
    expect(lastLogs).toContain('engine sync failed; continuing with the current version')
    // The same run reached the configured log file. The file name carries a
    // timestamp, so the newest ninfer-model run file is the one this launch
    // wrote.
    const logFile = resolveLogPath(
      readConfig().logPath,
      'ninfer',
      undefined,
      new Date(),
      process.env.HOME ?? '',
    )
    const dir = dirname(logFile)
    const logNames = (existsSync(dir) ? readdirSync(dir) : [])
      .filter((name) => name.startsWith('ninfer-model-') && name.endsWith('.log'))
      .sort()
    expect(logNames.length).toBeGreaterThan(0)
    expect(readFileSync(join(dir, logNames[logNames.length - 1]!), 'utf8')).toContain('!! git rebase')
    rmSync(dshEngineCacheDirectory('ninfer'), { recursive: true, force: true })
  })

  it('keeps the request auto-rebuild flag when the Get sync passes', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    // The Get sync passes (no stubbed failure), so the request's autoRebuild
    // threads into the deploy unchanged, on and absent.
    let seenOptions: { autoRebuild?: boolean } | undefined
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
      },
    })
    service.launch = async (plan: LaunchPlan, options?: { autoRebuild?: boolean }): Promise<LaunchResult> => {
      seenOptions = options
      return { plan, healthy: true }
    }
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 }, autoRebuild: true },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBe(true)
    seenOptions = undefined
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seenOptions?.autoRebuild).toBeUndefined()
  })

  it('streams the Get-step download chunks through the launch onChunk sink', async () => {
    writeConfig('ninfer', { port: 18020, model: 'qwen3-27b', modelDirectory: MODEL_DIR }, true)
    // The model artifact starts absent, so the launch's Get-step download runs.
    rmSync(join(MODEL_DIR, 'qwen3_8_27b_nvfp4.ninfer'), { force: true })
    const service = stubService([], {
      launchResult: { plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' }, healthy: true },
    })
    service.downloadModel = (
      _entry: DefaultModel,
      _directory: string,
      options?: { onChunk?: (chunk: string) => void },
    ) => {
      options?.onChunk?.('42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n')
      return Promise.resolve({ ok: true })
    }
    const chunks: string[] = []
    const result = await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-27b', modelDirectory: MODEL_DIR } },
      undefined,
      stubGetHost({ exists: false }).host,
      undefined,
      (chunk) => {
        chunks.push(chunk)
      },
    )
    expect(result.healthy).toBe(true)
    expect(chunks).toEqual(['42%| 4.2G/10G [00:12<00:16, 300.0MiB/s]\n'])
  })

  it('persists the launch logs as the last run and writes the log file', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\nlistening on 18020',
      },
    })
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-8-27b' } },
      undefined,
      stubGetHost().host,
    )
    // The last run is persisted under the "Launching..." separator, so the
    // card's Logs section shows it after a reload, and the resolved log file
    // carries the same output. The Get-step output the launch ran leads the
    // persisted run, so the launch preserves the Get logs, not wipes them.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs).toContain('model download: qwen3-8-27b has no registered default, skipped')
    expect(lastLogs.endsWith('engine booted\nlistening on 18020')).toBe(true)
    const logFile = resolveLogPath(
      readConfig().logPath,
      'ninfer',
      'qwen3-8-27b',
      new Date(),
      process.env.HOME ?? '',
    )
    // The exact timestamp the launch resolved is not known from here, so
    // assert the directory the file lands in holds a matching log.
    const dir = dirname(logFile)
    const entries = existsSync(dir) ? readdirSync(dir) : []
    expect(entries.some((name) => name.startsWith('ninfer-qwen3-8-27b-') && name.endsWith('.log'))).toBe(
      true,
    )
  })

  it('persists the Get-step output exactly once in a successful launch run', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], {
      launchResult: {
        plan: { engineId: 'ninfer', kind: 'process', port: 18020, healthUrl: 'http://127.0.0.1:18020/health' },
        healthy: true,
        logs: 'engine booted\nlistening on 18020',
      },
    })
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020, model: 'qwen3-8-27b' } },
      undefined,
      stubGetHost().host,
    )
    // The Get-step output leads the run logs composeLaunchLogs assembled in
    // the result, so the persisted run carries it once, not twice.
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.match(/get complete/g)?.length).toBe(1)
  })

  it('prints the plan launch command above the run logs the card shows', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const argv = ['infernix-serve', '/opt/hf-models/m.infernix', '--host', '127.0.0.1', '--port', '18080']
    const service = stubService([], {
      engines: [argvAdapter('infernix', argv)],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv, port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        logs: 'engine booted',
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The Get-step output the launch ran leads the result logs the route hands
    // the card, the command line follows it, and the engine output comes last.
    // The persisted last run carries the same order under the "Launching..."
    // separator, so the Logs section diagnoses the exact child process.
    expect(result.logs).toContain('get complete')
    expect(result.logs.endsWith(`${note}engine booted`)).toBe(true)
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs.endsWith(`${note}engine booted`)).toBe(true)
  })

  it('orders the build output before the launch command and the engine output', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const argv = ['infernix-serve', '/opt/hf-models/m.infernix', '--host', '127.0.0.1', '--port', '18080']
    const buildLogs =
      '>> /engines/infernix is behind dsh-fork/main; rebasing and rebuilding.\n' +
      '$ cd /engines/infernix && cmake --preset release\nbuild ok\n'
    const service = stubService([], {
      engines: [argvAdapter('infernix', argv)],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv, port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: true,
        logs: 'engine booted',
        buildLogs,
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    const note = '[local-infer] launch: infernix-serve /opt/hf-models/m.infernix --host 127.0.0.1 --port 18080\n'
    // The Get-step output the launch ran leads, the build output follows it,
    // the launch command follows that, and the engine output comes last.
    const logs = result.logs ?? ''
    const getEnd = logs.indexOf('get complete')
    const buildStart = logs.indexOf(buildLogs)
    const noteStart = logs.indexOf(note)
    expect(getEnd).toBeGreaterThanOrEqual(0)
    expect(buildStart).toBeGreaterThan(getEnd)
    expect(noteStart).toBeGreaterThanOrEqual(buildStart + buildLogs.length)
    expect(logs.endsWith('engine booted')).toBe(true)
    // The buildLogs transport field is folded into logs and cleared.
    expect(result.buildLogs).toBeUndefined()
  })

  it('persists the launch command before the deploy so a hung launch stays readable', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], { engines: [argvAdapter('infernix', ['infernix-serve', '--port', '18080'])] })
    let logsDuringLaunch: string | undefined
    service.launch = async (plan: LaunchPlan): Promise<LaunchResult> => {
      // The route wrote the Get steps and the command line before calling the
      // service, so a reload while the deploy and health poll are in flight
      // still shows them.
      logsDuringLaunch = readConfig().lastLogs
      return { plan, healthy: true }
    }
    await launchEngine(service, { engine: 'infernix', config: {} }, undefined, stubGetHost().host)
    expect(logsDuringLaunch).toContain('get complete')
    expect(logsDuringLaunch?.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
  })

  it('reports the launch command even when the deploy failed silently', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], {
      engines: [argvAdapter('infernix', ['infernix-serve', '--port', '18080'])],
      launchResult: {
        plan: { engineId: 'infernix', kind: 'process', argv: ['infernix-serve'], port: 18080, healthUrl: 'http://127.0.0.1:18080/health' },
        healthy: false,
        detail: 'build failed',
      },
    })
    const result = await launchEngine(
      service,
      { engine: 'infernix', config: {} },
      undefined,
      stubGetHost().host,
    )
    // A deploy that produced no engine output still carries the Get steps it
    // ran and the command it tried to run, so the Logs section is never blank
    // on a failed launch. The persisted last run leads with the "Launching..."
    // separator.
    expect(result.logs).toContain('get complete')
    expect(result.logs.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
    const lastLogs = readConfig().lastLogs
    expect(lastLogs.startsWith('--- Launching...\n')).toBe(true)
    expect(lastLogs).toContain('get complete')
    expect(lastLogs.endsWith('[local-infer] launch: infernix-serve --port 18080\n')).toBe(true)
  })

  it('renders the plan and calls the service stop entry point with it', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, { engine: 'ninfer', config: {} })
    expect(stoppedPlan?.engineId).toBe('ninfer')
    expect(stoppedPlan?.kind).toBe('process')
  })

  it('refuses to launch an engine no adapter serves with a 404', async () => {
    writeConfig('ninfer', {}, false) // Pinned: the trust gate is off, no platform, no providers.
    const service = stubService([], { engines: [] })
    await expect(launchEngine(service, { engine: 'strata' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })

  it('persists the launch record on the provider entry the launch names', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          argv: ['ninfer-serve', '/models/m.ninfer', '--port', '18020'],
          port: 18020,
          modelId: 'qwen3-27b',
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
        pid: 12345,
        parentPid: 999,
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      },
      undefined,
      stubGetHost().host,
    )
    // The record the restart re-link prices: the engine pid, the DSH parent
    // pid, the launch arguments, and the previous-pid list the core builder
    // seeds from the parent pid.
    const record = readConfig().providers[0]?.launch
    expect(record?.pid).toBe(12345)
    expect(record?.parentPid).toBe(999)
    expect(record?.argv).toEqual(['ninfer-serve', '/models/m.ninfer', '--port', '18020'])
    expect(record?.previousPids).toEqual([999])
    expect(record?.engineId).toBe('ninfer')
    expect(record?.port).toBe(18020)
    expect(record?.modelId).toBe('qwen3-27b')
    expect(typeof record?.startedAt).toBe('string')
  })

  it('persists the launch record on the engine+model entry when the launch names no provider', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
      launchResult: {
        plan: {
          engineId: 'ninfer',
          kind: 'process',
          argv: ['ninfer-serve'],
          port: 18020,
          healthUrl: 'http://127.0.0.1:18020/health',
        },
        healthy: true,
        pid: 12345,
        parentPid: 999,
      },
    })
    // No providerId: the route falls back to the stored entry with the same
    // engine and model.
    await launchEngine(
      service,
      { engine: 'ninfer', config: { model: 'qwen3-27b' } },
      undefined,
      stubGetHost().host,
    )
    expect(readConfig().providers[0]?.launch?.pid).toBe(12345)
  })

  it('persists no launch record when the deploy started no tracked process', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    const service = stubService([], {
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
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      },
      undefined,
      stubGetHost().host,
    )
    expect(readConfig().providers[0]?.launch).toBeUndefined()
  })

  it('clears the launch record on a stop of the named provider', async () => {
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
          previousPids: [888, 999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The record (the previous-pid list with it) is gone, so a recycled pid
    // cannot re-link an engine the user just stopped.
    const stored = readConfig()
    expect(stored.providers[0]?.launch).toBeUndefined()
  })

  it('stamps the re-adopted engine pid from the stored launch record', async () => {
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
          previousPids: [888, 999],
          engineId: 'ninfer',
          port: 18020,
          modelId: 'qwen3-27b',
        },
      },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The pid the adapter signals through the host: the process a DSH restart
    // re-adopted, which the adapter tracks no child handle for.
    expect(stoppedPlan?.pid).toBe(12345)
  })

  it('stamps no pid when the target entry carries no launch record', async () => {
    writeConfig('ninfer', { model: 'qwen3-27b' }, false, {}, true, [
      { id: 'p1', engine: 'ninfer', config: { model: 'qwen3-27b' }, platform: {} },
    ])
    let stoppedPlan: LaunchPlan | undefined
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (plan: LaunchPlan) => {
      stoppedPlan = plan
    }
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // A fresh stop of an idle engine names nothing to signal.
    expect(stoppedPlan?.pid).toBeUndefined()
  })

  it('persists a stop-failure note to the last-run logs and the log file', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        {
          id: 'p1',
          engine: 'ninfer',
          config: { model: 'qwen3-27b' },
          platform: {},
          launch: {
            pid: 12345,
            startedAt: '2026-10-14T12:00:00.000Z',
            argv: ['ninfer-serve'],
            previousPids: [999],
            engineId: 'ninfer',
            port: 18020,
            modelId: 'qwen3-27b',
          },
        },
      ],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    service.stop = async (): Promise<void> => {
      throw new Error('stop: signal pid 12345 failed: No such process')
    }
    await expect(
      stopEngine(service, {
        engine: 'ninfer',
        config: { model: 'qwen3-27b' },
        providerId: 'p1',
      }),
    ).rejects.toThrow('stop: signal pid 12345 failed')
    // The failure note landed in the last-run logs (the card's Logs section)
    // beside the previous run, and the record stays, so the engine the kill
    // could not reach is not read as stopped.
    const stored = readConfig()
    expect(stored.lastLogs).toContain('engine up')
    expect(stored.lastLogs).toContain(
      '[local-infer] stop failed for ninfer (qwen3-27b): stop: signal pid 12345 failed: No such process',
    )
    expect(stored.providers[0]?.launch).toBeDefined()
    // The note also reached the configured log file, the same per-run rule the
    // launch step applies.
    const logFile = resolveLogPath(
      stored.logPath,
      'ninfer',
      'qwen3-27b',
      new Date(),
      process.env.HOME ?? '',
    )
    const dir = dirname(logFile)
    const entries = existsSync(dir) ? readdirSync(dir) : []
    expect(
      entries.some((name) => name.startsWith('ninfer-qwen3-27b-') && name.endsWith('.log')),
    ).toBe(true)
  })

  it('writes no stop-failure note when the stop succeeds', async () => {
    writeConfig(
      'ninfer',
      { model: 'qwen3-27b' },
      false,
      {},
      true,
      [
        {
          id: 'p1',
          engine: 'ninfer',
          config: { model: 'qwen3-27b' },
          platform: {},
          launch: {
            pid: 12345,
            startedAt: '2026-10-14T12:00:00.000Z',
            argv: ['ninfer-serve'],
            previousPids: [999],
            engineId: 'ninfer',
            port: 18020,
            modelId: 'qwen3-27b',
          },
        },
      ],
      DEFAULT_LOG_PATH_TEMPLATE,
      'engine up\n',
    )
    const service = stubService([], { engines: [fakeAdapter('ninfer')] })
    await stopEngine(service, {
      engine: 'ninfer',
      config: { model: 'qwen3-27b' },
      providerId: 'p1',
    })
    // The last-run logs stay as the launch left them, and the record is
    // cleared with the stop.
    const stored = readConfig()
    expect(stored.lastLogs).toBe('engine up\n')
    expect(stored.providers[0]?.launch).toBeUndefined()
  })
})

describe('platform config (§3.10) round trip and launch pass-through', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-platform-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('round-trips the per-engine platform config through the file', () => {
    writeConfig('ninfer', {}, false, {
      ninfer: { engineDirectory: '/home/derek/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
    })
    const stored = readConfig()
    expect(stored.platform).toEqual({
      ninfer: {
        engineDirectory: '/home/derek/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
      },
    })
  })

  it('drops a non-object platform map and non-string fields', () => {
    const path = localInferConfigPath()
    // A by-hand edit can leave a malformed platform map; the route reads it
    // as absent rather than poisoning the deploy step.
    writeFileSync(
      path,
      JSON.stringify({
        engine: 'ninfer',
        config: {},
        allowRunDeps: false,
        platform: { ninfer: { engineDirectory: 42, engineFork: 'ok' }, hyperqwen: 'not-an-object' },
      }),
    )
    expect(readConfig().platform).toEqual({
      ninfer: { engineFork: 'ok' },
    })
  })

  it('exposes the stored platform map in the summary', async () => {
    writeConfig('ninfer', {}, false, {
      ninfer: { engineDirectory: '/home/derek/src/ninfer' },
    })
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.platformConfigs).toEqual({
      ninfer: { engineDirectory: '/home/derek/src/ninfer' },
    })
  })

  it('seeds the engine platform defaults in the summary engine list', async () => {
    writeConfig('ninfer', {}, false, {})
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    const ninfer = summary.engines.find((entry) => entry.id === 'ninfer')
    expect(ninfer?.defaultBuildCommand).toBe(
      'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
    )
    expect(ninfer?.defaultDockerTag).toBe('ghcr.io/iamwavecut/ninfer-all')
    // A docker-only engine (compose vLLM) carries a docker tag and no local
    // build command; a local-only engine (Infernix) is the reverse. The compose
    // engine's tag field seeds the compose arguments (the profile the up runs).
    const hyperqwen = summary.engines.find((entry) => entry.id === 'hyperqwen')
    expect(hyperqwen?.defaultDockerTag).toBe('--profile single')
    expect(hyperqwen?.defaultBuildCommand).toBeUndefined()
    const infernix = summary.engines.find((entry) => entry.id === 'infernix')
    expect(infernix?.defaultBuildCommand).toBe('cd {dir} && cmake --preset release && cmake --build build -j')
    expect(infernix?.defaultDockerTag).toBeUndefined()
    // Every engine entry carries its default checkout home, so the card's
    // Engine Directory placeholder shows the real path for the selected engine.
    expect(ninfer?.defaultEngineDirectory).toBe(dshEngineCacheDirectory('ninfer'))
    expect(infernix?.defaultEngineDirectory).toBe(dshEngineCacheDirectory('infernix'))
  })

  it('round-trips the build commands and docker tag platform overrides', async () => {
    writeConfig('ninfer', {}, false, {
      ninfer: {
        buildCommands: 'cmake -S {dir} -B {dir}/build',
        dockerTag: 'ghcr.io/iamwavecut/ninfer-all:dev',
      },
    })
    const summary = await buildSummary(stubService([]), { engine: 'ninfer', config: {} })
    expect(summary.platformConfigs).toEqual({
      ninfer: {
        buildCommands: 'cmake -S {dir} -B {dir}/build',
        dockerTag: 'ghcr.io/iamwavecut/ninfer-all:dev',
      },
    })
  })

  it('registers the request platform override with the service before launch', async () => {
    writeConfig('ninfer', { port: 18020 }, false, {}) // Pinned: clean stored platform map; the request carries the override.
    let seen: EnginePlatformConfig | undefined
    const service = stubService([], {
      onPlatform: (config: EnginePlatformConfig) => {
        seen = config
      },
    })
    await launchEngine(
      service,
      {
        engine: 'ninfer',
        config: { port: 18020 },
        platform: { engineDirectory: '/home/derek/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
      },
      undefined,
      stubGetHost().host,
    )
    expect(seen).toEqual({
      engineId: 'ninfer',
      engineDirectory: '/home/derek/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
  })

  it('registers the fallback engine directory when the launch request carries no platform', async () => {
    // Reset the stored platform map so the test reads a clean entry, not the
    // build commands and docker tag a sibling test wrote.
    writeConfig('ninfer', { port: 18020 }, false, {})
    let seen: EnginePlatformConfig | undefined
    const service = stubService([], {
      onPlatform: (config: EnginePlatformConfig) => {
        seen = config
      },
    })
    // A launch with no Engine Directory override falls back to the engine's
    // default checkout home (~/.cache/dsh/infer/<engine-id>), so the deploy
    // step resolves a relative launch path against a real checkout; the
    // fallback rides the in-memory registry only, never the stored map.
    await launchEngine(
      service,
      { engine: 'ninfer', config: { port: 18020 } },
      undefined,
      stubGetHost().host,
    )
    expect(seen).toEqual({
      engineId: 'ninfer',
      engineDirectory: dshEngineCacheDirectory('ninfer'),
    })
    // The resolved default never leaks into storage: the stored platform
    // map stays the clean entry the test wrote.
    expect(readConfig().platform).toEqual({})
  })
})
