import { describe, expect, it } from 'vitest'
import {
  HyperQwenAdapter,
  LLAMACPP_DOCKER_IMAGE,
  NINFER_DOCKER_IMAGE,
  NINFER_MODEL_ARTIFACTS,
  NInferAdapter,
  STRATA_DOCKER_IMAGE,
  StrataAdapter,
  LlamaCppAdapter,
  envFromSpecs,
  flagsFromSpecs,
  pollHealth,
} from '../src/adapters.ts'
import { NINFER_PARAMETERS } from '../src/ninfer.ts'
import { HYPERQWEN_PARAMETERS } from '../src/hyperqwen.ts'
import { LLAMACPP_PARAMETERS } from '../src/llamacpp.ts'
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
    expect(argv[1]).toBe('/models/qwen3_8_27b_nvfp4.ninfer')
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

  it('launches a directory-scanned .ninfer file as-is', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
        modelDirectory: '/models',
        port: 18020,
      },
      HW,
    )
    expect(plan.modelId).toBe('qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer')
    expect(plan.argv?.[1]).toBe('/models/qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer')
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

  it('treats a compose plan as a no-op and skips the download when no artifact is named', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    // A compose plan is a no-op for a process/docker engine.
    const compose: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'compose',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    expect(await adapter.deploy(compose)).toEqual({ ok: true })
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(0)
    // A process plan that names no modelId skips the model download.
    const bare: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(bare)
    expect(result.ok).toBe(true)
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(1)
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

describe('adapter modelRef (the registrar model seam)', () => {
  it('resolves the NInfer model id the engine serves, not the registry key', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    // The config names the VramModel registry key; the engine serves the
    // artifact's --model-id alias, which is what the registrar publishes.
    expect(adapter.modelRef({ model: 'qwen3-27b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    expect(adapter.modelRef({ model: 'qwen3-35b' })).toEqual({
      id: 'Qwen3.8-35B-A3B',
      name: 'Qwen3.8-35B-A3B',
    })
    // An unknown model id falls back to the 27B artifact, the renderLaunch
    // rule, so a bare config always resolves a model.
    expect(adapter.modelRef({ model: 'qwen3-99b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    // No model named: the 27B default.
    expect(adapter.modelRef({})).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })
  })

  it('publishes the engine id for Hyper-Qwen until per-model data lands', () => {
    const { host } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    expect(adapter.modelRef({})).toEqual({ id: 'hyperqwen', name: 'Hyper-Qwen' })
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

  it('exposes the Hyper-Qwen spec surface and reports a failed compose up', async () => {
    const { host, state } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    // The adapter's parameter surface is the Hyper-Qwen spec data.
    expect(adapter.parameters()).toHaveLength(HYPERQWEN_PARAMETERS.length)
    // A failed compose up reads as not-ok with the detail.
    state.runOk = false
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
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('compose up failed')
    // The health check polls the health URL through the shared helper.
    state.runOk = true
    state.fetchSequence = [503, 200]
    const health = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(health.healthy).toBe(true)
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

describe('LlamaCppAdapter', () => {
  it('renders a local process plan with the GGUF path and the spec flags', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', ctxSize: 8192, kvCacheType: 'q8_0', port: 8080, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('llamacpp')
    expect(plan.port).toBe(8080)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8080/health')
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.modelDirectory).toBe('/models')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('llama-server')
    expect(argv).toContain('--model')
    expect(argv).toContain('/models/Qwen3.8-27B-Q4_K_M.gguf')
    expect(argv).toContain('--ctx-size')
    expect(argv).toContain('8192')
    expect(argv).toContain('--cache-type-k')
    expect(argv).toContain('q8_0')
    expect(argv).toContain('--port')
    expect(argv).toContain('8080')
  })

  it('renders a docker plan with the ggml image, a named container, and the host port map', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', buildMode: 'docker', ctxSize: 8192, port: 8080, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('docker')
    expect(plan.containerName).toBe('llamacpp-8080')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv[1]).toBe('run')
    expect(argv).toContain(LLAMACPP_DOCKER_IMAGE)
    expect(argv).toContain('--model')
    expect(argv).toContain('/models/Qwen3.8-27B-Q4_K_M.gguf')
  })

  it('defaults to the 27B artifact and the 8080 port when the config names neither', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch({}, HW)
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.port).toBe(8080)
    expect(plan.argv?.[2]).toBe('Qwen3.8-27B-Q4_K_M.gguf')
  })

  it('launches a directory-scanned .gguf file as-is', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'Qwen3.8-27B-Q4_K_M.gguf', modelDirectory: '/models', port: 8080 },
      HW,
    )
    expect(plan.modelId).toBe('Qwen3.8-27B-Q4_K_M.gguf')
    expect(plan.argv).toContain('/models/Qwen3.8-27B-Q4_K_M.gguf')
  })

  it('builds in the engine directory, downloads the GGUF, and spawns the engine', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'process',
      argv: ['llama-server', '/models/x.gguf'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'llamacpp',
      engineDirectory: '/src/llama.cpp',
      engineFork: 'https://github.com/ggml-org/llama.cpp',
    })
    expect(result.ok).toBe(true)
    expect(state.run[0]).toContain('git clone https://github.com/ggml-org/llama.cpp /src/llama.cpp')
    expect(state.run[1]).toContain('cmake -S /src/llama.cpp -B /src/llama.cpp/build')
    expect(state.run[2]).toContain('hf download')
    expect(state.run[2]).toContain('--local-dir /models')
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/llama.cpp')
  })

  it('pulls the image and spawns the container for a docker plan', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'docker',
      argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE, '--model', 'x.gguf'],
      env: {},
      containerName: 'llamacpp-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${LLAMACPP_DOCKER_IMAGE}`)
    expect(state.spawn).toHaveLength(1)
  })

  it('polls the health URL and stops the named container and tracked process', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 200]
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'docker',
      argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE, '--model', 'x.gguf'],
      env: {},
      containerName: 'llamacpp-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(true)
    await adapter.deploy(plan)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop llamacpp-8080')
    expect(state.killed).toContain(1234)
  })

  it('publishes the artifact model id the engine serves', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    expect(adapter.modelRef({ model: 'qwen3-27b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    // No model named: the 27B default.
    expect(adapter.modelRef({})).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })
  })

  it('spells the spec surface into flags through the shared helper', () => {
    const flags = flagsFromSpecs(LLAMACPP_PARAMETERS, { ctxSize: 8192, kvCacheType: 'q4_0' })
    expect(flags).toContain('--ctx-size')
    expect(flags).toContain('8192')
    expect(flags).toContain('--cache-type-k')
    expect(flags).toContain('q4_0')
    // A boolean default of false contributes no flag.
    expect(flags).not.toContain('--flash-attn')
  })

  it('exposes the llama.cpp spec surface through the adapter', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    expect(adapter.parameters()).toHaveLength(LLAMACPP_PARAMETERS.length)
    expect(adapter.parameters()).toBe(LLAMACPP_PARAMETERS)
  })

  it('skips a spec whose value and default are both undefined', () => {
    // A spec with a toArgv but no defaultValue contributes nothing when the
    // config leaves the key unset, so a bare config renders a bare plan.
    const specs = [
      {
        key: 'custom',
        label: 'Custom',
        description: 'A flag with no default.',
        form: { kind: 'text' },
        toArgv: (value: unknown) => (value ? ['--custom', String(value)] : []),
      },
    ]
    expect(flagsFromSpecs(specs, {})).toEqual([])
    expect(envFromSpecs(specs, {})).toEqual({})
  })

  it('reports a failed clone, build, and download as not-ok with the detail', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new LlamaCppAdapter(host)
    // With a fork, the first run is the clone, so a failed run reads as a clone failure.
    const clonePlan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'process', argv: ['llama-server', 'x.gguf'], env: {},
      modelId: 'qwen3-27b', port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    const cloneResult = await adapter.deploy(clonePlan, {
      engineId: 'llamacpp', engineDirectory: '/src/llama.cpp',
      engineFork: 'https://github.com/ggml-org/llama.cpp',
    })
    expect(cloneResult.ok).toBe(false)
    expect(cloneResult.detail).toContain('git clone failed')
    // Without a fork the clone is skipped, so a failed run reads as a build failure.
    state.run = []
    const buildResult = await adapter.deploy(clonePlan, {
      engineId: 'llamacpp', engineDirectory: '/src/llama.cpp',
    })
    expect(buildResult.ok).toBe(false)
    expect(buildResult.detail).toContain('build failed')
    // Without an engine dir the clone and build are skipped, so a failed run reads
    // as a model-download failure (the plan names the 27B artifact).
    state.run = []
    const downloadResult = await adapter.deploy(clonePlan)
    expect(downloadResult.ok).toBe(false)
    expect(downloadResult.detail).toContain('model download failed')
    expect(state.run.length).toBeGreaterThan(0)
  })

  it('reports a failed docker pull as not-ok and treats a compose plan as a no-op', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'docker', argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE],
      env: {}, containerName: 'llamacpp-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('docker pull failed')
    // A compose plan is a no-op for a process/docker engine.
    state.runOk = true
    const compose: LaunchPlan = { engineId: 'llamacpp', kind: 'compose', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    expect(await adapter.deploy(compose)).toEqual({ ok: true })
    expect(state.spawn).toHaveLength(0)
  })

  it('skips the model download when the plan names no artifact', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'process', argv: ['llama-server', 'x.gguf'], env: {},
      port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // No modelId, so no hf download command runs; only the spawn happens.
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(1)
  })
})

describe('StrataAdapter', () => {
  it('renders a docker plan with the Strata image and a named container', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090 }, HW)
    expect(plan.kind).toBe('docker')
    expect(plan.engineId).toBe('strata')
    expect(plan.containerName).toBe('strata-8090')
    expect(plan.port).toBe(8090)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8090/health')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv).toContain(STRATA_DOCKER_IMAGE)
  })

  it('renders an empty spec surface, so the plan carries no flags', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    expect(adapter.parameters()).toEqual([])
    // The bare plan: the image and the port map, nothing from a spec surface.
    // docker run --rm --gpus all --name <c> -p <map> <image> = 10 elements.
    const plan = adapter.renderLaunch({}, HW)
    expect(plan.argv).toHaveLength(10)
  })

  it('pulls the image and stops the named container', async () => {
    const { host, state } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata',
      kind: 'docker',
      argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {},
      containerName: 'strata-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${STRATA_DOCKER_IMAGE}`)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop strata-8080')
    expect(state.killed).toContain(1234)
  })

  it('publishes the engine id until per-model data lands', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    expect(adapter.modelRef({})).toEqual({ id: 'strata', name: 'Strata' })
  })

  it('reports a failed docker pull as not-ok', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'docker', argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {}, containerName: 'strata-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('docker pull failed')
  })

  it('polls the health URL until a 200', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 200]
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'docker', argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {}, containerName: 'strata-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(true)
    expect(state.fetch).toHaveLength(2)
  })
})

describe('nodeLifecycleHost (the live host the service wires in)', () => {
  it('runs a command through the shell and reads a clean exit as ok', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    const ok = await nodeLifecycleHost.run('echo local-infer-probe')
    expect(ok.ok).toBe(true)
  })

  it('reads a non-zero exit as not-ok with the captured detail', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // `false` exits 1 with no stderr; the detail carries the error string.
    const failed = await nodeLifecycleHost.run('false')
    expect(failed.ok).toBe(false)
    expect(failed.detail?.length).toBeGreaterThan(0)
  })

  it('spawns a detached child the stop step can signal', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // A real node child: a no-op that exits immediately. The handle carries a
    // pid and a kill the stop step calls; the child is unrefed so it never
    // keeps the test process alive.
    const handle = nodeLifecycleHost.spawn(['node', '-e', 'setTimeout(() => {}, 50)'], {})
    expect(handle.pid).toBeGreaterThan(0)
    expect(typeof handle.kill).toBe('function')
    handle.kill()
  })

  it('reads a connection failure as status 0, the poll not-ready signal', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // Port 1 on loopback has nothing listening, so the fetch throws and the
    // host reports status 0, the same signal pollHealth treats as not-ready.
    const result = await nodeLifecycleHost.fetch('http://127.0.0.1:1/health')
    expect(result.status).toBe(0)
    expect(result.ok).toBe(false)
  })
})

describe('adapter launchSignature (the Phase 10 process-match data)', () => {
  it('NInfer: the local signature is the ninfer-serve binary and the config port', () => {
    const adapter = new NInferAdapter()
    const signature = adapter.launchSignature({ port: 18020 })
    expect(signature).toEqual({ binary: 'ninfer-serve', port: 18020 })
  })

  it('NInfer: the docker signature is the ghcr image marker and the config port', () => {
    const adapter = new NInferAdapter()
    const signature = adapter.launchSignature({ buildMode: 'docker', port: 19000 })
    expect(signature).toEqual({ binary: NINFER_DOCKER_IMAGE, port: 19000 })
  })

  it('NInfer: a bare config falls back to the adapter default port', () => {
    const adapter = new NInferAdapter()
    expect(adapter.launchSignature()).toEqual({ binary: 'ninfer-serve', port: 18020 })
  })

  it('Hyper-Qwen: the signature is the docker compose command, port, and toEnv keys', () => {
    const adapter = new HyperQwenAdapter()
    const signature = adapter.launchSignature({ port: 18021, spec: 'dflash2', ctx: 32768 })
    expect(signature?.binary).toBe('docker compose')
    expect(signature?.port).toBe(18021)
    // The toEnv keys ride along so a process line that carries env data must
    // set at least one of them.
    expect(signature?.envKeys).toEqual(
      expect.arrayContaining(['SPEC', 'CTX', 'KV']),
    )
  })

  it('llama.cpp: the local signature is the llama-server binary, the docker one the ggml image', () => {
    const adapter = new LlamaCppAdapter()
    expect(adapter.launchSignature({ port: 8081 })).toEqual({ binary: 'llama-server', port: 8081 })
    expect(adapter.launchSignature({ buildMode: 'docker', port: 8081 })).toEqual({
      binary: LLAMACPP_DOCKER_IMAGE,
      port: 8081,
    })
  })

  it('Strata: the signature is the Strata image marker and the port', () => {
    const adapter = new StrataAdapter()
    expect(adapter.launchSignature({ port: 8082 })).toEqual({
      binary: STRATA_DOCKER_IMAGE,
      port: 8082,
    })
  })
})
