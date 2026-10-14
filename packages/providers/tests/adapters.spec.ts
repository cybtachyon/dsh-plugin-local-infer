import { describe, expect, it } from 'vitest'
import {
  HyperQwenAdapter,
  NINFER_DOCKER_IMAGE,
  NINFER_MODEL_ARTIFACTS,
  NInferAdapter,
  envFromSpecs,
  flagsFromSpecs,
  pollHealth,
} from '../src/adapters.ts'
import { NINFER_PARAMETERS } from '../src/ninfer.ts'
import { HYPERQWEN_PARAMETERS } from '../src/hyperqwen.ts'
import type {
  CommandOutcome,
  FetchResult,
  HardwareProfile,
  LaunchPlan,
  LifecycleHost,
  ProcessHandle,
} from '../../core/lib/index.js'

const HW: HardwareProfile = { dockerAvailable: true, wsl2: false, os: 'linux', cpuThreads: 8 }

/**
 * A stub LifecycleHost that records every run, spawn, and fetch call so the
 * adapter steps can be asserted on without a real build, docker, or network.
 * `fetchSequence` feeds a per-call status list (shifted off per poll); an
 * exhausted sequence falls back to the constant `fetchStatus`.
 */
function stubHost() {
  const state = {
    run: [] as string[],
    spawn: [] as { argv: string[]; env: Record<string, string>; cwd?: string }[],
    fetch: [] as string[],
    killed: [] as number[],
    fetchStatus: 200,
    fetchSequence: [] as number[],
    runOk: true,
  }
  const host: LifecycleHost = {
    async run(command: string): Promise<CommandOutcome> {
      state.run.push(command)
      return state.runOk ? { ok: true } : { ok: false, detail: 'run failed' }
    },
    spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle {
      state.spawn.push({ argv: [...argv], env: { ...env }, cwd })
      return {
        pid: 1234,
        kill: (): void => {
          state.killed.push(1234)
        },
      }
    },
    async fetch(url: string): Promise<FetchResult> {
      state.fetch.push(url)
      const status =
        state.fetchSequence.length > 0 ? (state.fetchSequence.shift() as number) : state.fetchStatus
      return { status, ok: status === 200 }
    },
  }
  return { host, state }
}

describe('NInferAdapter.renderLaunch', () => {
  it('renders a local process plan with the model path and spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 32768, port: 18020, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('ninfer')
    expect(plan.port).toBe(18020)
    expect(plan.healthUrl).toBe('http://127.0.0.1:18020/health')
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.modelDirectory).toBe('/models')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('ninfer-serve')
    expect(argv[1]).toBe('/models/qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer')
    expect(argv).toContain('--port')
    expect(argv).toContain('18020')
    expect(argv).toContain('--kv-dtype')
    expect(argv).toContain('int8')
    expect(argv).toContain('--max-context')
    expect(argv).toContain('32768')
  })

  it('renders a docker plan with the ghcr image, a named container, and the spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3-27b',
        buildMode: 'docker',
        kvDtype: 'int8',
        port: 18020,
        modelDirectory: '/models',
      },
      HW,
    )
    expect(plan.kind).toBe('docker')
    expect(plan.containerName).toBe('ninfer-18020')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv[1]).toBe('run')
    expect(argv).toContain(NINFER_DOCKER_IMAGE)
    expect(argv).toContain('serve')
    expect(argv).toContain('--kv-dtype')
  })

  it('defaults to the 27B artifact when the config names no model', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch({ port: 18020 }, HW)
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.argv?.[1]).toBe(NINFER_MODEL_ARTIFACTS['qwen3-27b']!.file)
  })
})

describe('NInferAdapter.deploy', () => {
  it('builds in the engine directory, downloads the model, and spawns the engine', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
    expect(result.ok).toBe(true)
    expect(state.run[0]).toContain('git clone https://github.com/iamwavecut/ninfer-all /src/ninfer')
    expect(state.run[1]).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
    expect(state.run[2]).toContain('hf download')
    expect(state.run[2]).toContain('--local-dir /models')
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/ninfer')
  })

  it('skips the clone and build when no platform config is stored', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // Only the model download runs; no clone or build without an engine dir.
    expect(state.run).toHaveLength(1)
    expect(state.run[0]).toContain('hf download')
  })

  it('pulls the image and spawns the container for a docker plan', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'docker',
      argv: ['docker', 'run', NINFER_DOCKER_IMAGE, 'serve', 'x.ninfer'],
      env: {},
      containerName: 'ninfer-18020',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${NINFER_DOCKER_IMAGE}`)
    expect(state.spawn).toHaveLength(1)
  })

  it('reports a failed build as not-ok with the detail', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, { engineId: 'ninfer', engineDirectory: '/src/ninfer' })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('build failed')
  })
})

describe('NInferAdapter.healthCheck and stop', () => {
  it('polls the health URL until a 200', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 503, 200]
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 5 })
    expect(result.healthy).toBe(true)
    expect(result.status).toBe(200)
    expect(state.fetch).toHaveLength(3)
  })

  it('reports not-healthy when the cap is reached without a 200', async () => {
    const { host, state } = stubHost()
    state.fetchStatus = 503
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 2 })
    expect(result.healthy).toBe(false)
    expect(result.status).toBe(503)
    expect(state.fetch).toHaveLength(2)
  })

  it('stops the named container and signals the tracked process', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'docker',
      argv: ['docker', 'run', NINFER_DOCKER_IMAGE, 'serve', 'x.ninfer'],
      env: {},
      containerName: 'ninfer-18020',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    await adapter.deploy(plan)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop ninfer-18020')
    expect(state.killed).toContain(1234)
  })
})

describe('HyperQwenAdapter', () => {
  it('renders a compose plan with the env the spec surface maps to', () => {
    const { host } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan = adapter.renderLaunch(
      { spec: 'dflash2', draftTokens: 15, port: 18020, composeFile: '/src/hyper-qwen/docker-compose.yml' },
      HW,
    )
    expect(plan.kind).toBe('compose')
    expect(plan.engineId).toBe('hyperqwen')
    expect(plan.composeFile).toBe('/src/hyper-qwen/docker-compose.yml')
    expect(plan.profile).toBe('single')
    expect(plan.port).toBe(18020)
    expect(plan.env).toEqual(
      expect.objectContaining({ SPEC: 'dflash2', DFLASH_TOKENS: '15', PORT: '18020' }),
    )
  })

  it('deploys with compose up and stops with compose down', async () => {
    const { host, state } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'hyperqwen',
      kind: 'compose',
      env: {},
      composeFile: 'docker-compose.yml',
      profile: 'single',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe('docker compose -f docker-compose.yml --profile single up --pull always -d')
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker compose -f docker-compose.yml --profile single down')
  })
})

describe('spec flag and env helpers', () => {
  it('flagsFromSpecs runs each toArgv over the config value or the spec default', () => {
    const flags = flagsFromSpecs(NINFER_PARAMETERS, { kvDtype: 'int8', maxContext: 4096 })
    expect(flags).toContain('--kv-dtype')
    expect(flags).toContain('int8')
    expect(flags).toContain('--max-context')
    expect(flags).toContain('4096')
    // A boolean default of false contributes no flag.
    expect(flags).not.toContain('--vision')
  })

  it('envFromSpecs runs each toEnv over the config value or the spec default', () => {
    const env = envFromSpecs(HYPERQWEN_PARAMETERS, { spec: 'dflash2', draftTokens: 7 })
    expect(env.SPEC).toBe('dflash2')
    expect(env.DFLASH_TOKENS).toBe('7')
    // A numeric default (gpuUtil 0.93) is spelled into the env.
    expect(env.GPU_UTIL).toBe('0.93')
  })
})

describe('pollHealth', () => {
  it('reads a connection failure (status 0) as not-ready and keeps polling', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [0, 0, 200]
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await pollHealth(host, plan, { pollMs: 0, maxAttempts: 5 })
    expect(result.healthy).toBe(true)
    expect(state.fetch).toHaveLength(3)
  })
})
