import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LocalInfer from 'dsh-plugin-local-infer/service'
import {
  hfHubCacheDirectory,
  hubCacheModelDirectory,
  repoIdFromUrl,
} from 'dsh-plugin-local-infer/core'
import type {
  CommandOutcome,
  FetchResult,
  HardwareProfile,
  LaunchPlan,
  LifecycleHost,
  ProcessHandle,
} from 'dsh-plugin-local-infer/core'
import localInferProviders from '../src/index.ts'
import { configFileFromSpecs } from '../src/adapters.ts'
import { ENGINES } from '../src/engines.ts'
import { engineOsProfile, engineSource } from '../src/acquire.ts'
import { defaultModelsForEngine } from '../src/model-defaults.ts'
import { BASALT_VRAM_MODELS, basaltVramModel } from '../src/vram.ts'
import { BUILTIN_GUIDELINES } from '../src/guidelines.ts'
import { BUILTIN_PRESETS } from '../src/presets.ts'
import {
  BASALT_CONFIG_FILE,
  BASALT_MODEL_FILE,
  BASALT_MODEL_REPO,
  BasaltAdapter,
} from '../src/engines/basalt/basaltAdapter.ts'
import {
  BASALT_EXPERT_CACHE_OPTIONS,
  BASALT_KV_OPTIONS,
  BASALT_PARAMETERS,
  BASALT_VISION_OPTIONS,
  basaltModelKey,
} from '../src/engines/basalt/basalt.ts'
import { BASALT_LINUX } from '../src/engines/basalt/basaltLinux.ts'
import { BASALT_MACOS } from '../src/engines/basalt/basaltMacOS.ts'
import { BASALT_WINDOWS } from '../src/engines/basalt/basaltWindows.ts'

describe('Basalt parameter surface', () => {
  it('ships the basalt config surface, one spec per setting, in form order', () => {
    const keys = BASALT_PARAMETERS.map((spec) => spec.key)
    expect(keys).toEqual([
      'port',
      'host',
      'gpu',
      'parallel',
      'vision',
      'model',
      'kv',
      'maxContext',
      'expertCache',
      'prefill',
      'residentExperts',
      'spec',
    ])
  })

  it('gives every spec a config deploy target with the server or engine block', () => {
    const byKey = Object.fromEntries(BASALT_PARAMETERS.map((spec) => [spec.key, spec]))
    // The server-block settings nest under `server` in basalt_config.json.
    for (const key of ['port', 'host', 'gpu', 'parallel', 'vision', 'model']) {
      expect(byKey[key]?.deploy).toEqual({ target: 'config', format: 'json', block: 'server' })
    }
    // The engine-block settings nest under `engine`; the multi-word keys name
    // their dash flag spelling in `deploy.key`.
    expect(byKey['kv']?.deploy).toEqual({ target: 'config', format: 'json', block: 'engine' })
    expect(byKey['maxContext']?.deploy).toEqual({
      target: 'config',
      format: 'json',
      block: 'engine',
      key: 'max-context',
    })
    expect(byKey['expertCache']?.deploy).toEqual({
      target: 'config',
      format: 'json',
      block: 'engine',
      key: 'expert-cache',
    })
    expect(byKey['prefill']?.deploy).toEqual({ target: 'config', format: 'json', block: 'engine' })
    expect(byKey['residentExperts']?.deploy).toEqual({
      target: 'config',
      format: 'json',
      block: 'engine',
      key: 'resident-experts',
    })
    expect(byKey['spec']?.deploy).toEqual({ target: 'config', format: 'json', block: 'engine' })
  })

  it('offers the kv, vision, and expert-cache option lists', () => {
    expect(BASALT_KV_OPTIONS.map((option) => option.value)).toEqual(['fp16', 'int8', 'q4_0', 'k8v4'])
    expect(BASALT_VISION_OPTIONS.map((option) => option.value)).toEqual(['off', 'dynamic', 'cpu'])
    expect(BASALT_EXPERT_CACHE_OPTIONS.map((option) => option.value)).toEqual(['auto'])
  })

  it('reads the model key from the config, falling back to an empty string', () => {
    expect(basaltModelKey({ model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt' })).toBe(
      'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt',
    )
    expect(basaltModelKey({})).toBe('')
    expect(basaltModelKey({ model: 42 })).toBe('')
  })

  it('renders a representative config into a { server, engine } JSON object', () => {
    const config = {
      port: 8090,
      host: '127.0.0.1',
      gpu: '0,1',
      parallel: 2,
      vision: 'dynamic',
      model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt',
      kv: 'int8',
      maxContext: 32768,
      expertCache: 'auto',
      prefill: 'auto',
      residentExperts: true,
      spec: 8,
    }
    const content = configFileFromSpecs(BASALT_PARAMETERS, config, 'json')
    const object = JSON.parse(content) as { server: Record<string, unknown>; engine: Record<string, unknown> }
    expect(object.server).toEqual({
      port: 8090,
      host: '127.0.0.1',
      gpu: '0,1',
      parallel: 2,
      vision: 'dynamic',
      model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt',
    })
    // The multi-word engine keys render under their dash flag spelling.
    expect(object.engine).toEqual({
      kv: 'int8',
      'max-context': 32768,
      'expert-cache': 'auto',
      prefill: 'auto',
      'resident-experts': true,
      spec: 8,
    })
  })

  it('renders the spec defaults for unset settings and omits the defaultless gpu', () => {
    // Only the model and the kv format are set. Every spec that declares a
    // defaultValue renders that default; gpu has no default and is unset, so
    // it stays out of the file and the engine picks the card itself.
    const content = configFileFromSpecs(BASALT_PARAMETERS, { model: 'm.basalt', kv: 'int8' }, 'json')
    const object = JSON.parse(content) as { server: Record<string, unknown>; engine: Record<string, unknown> }
    expect(object.server).toEqual({
      port: 8080,
      host: '127.0.0.1',
      parallel: 1,
      vision: 'off',
      model: 'm.basalt',
    })
    expect(object.engine).toEqual({
      kv: 'int8',
      'max-context': 4096,
      'expert-cache': 'auto',
      prefill: 'auto',
      'resident-experts': true,
      spec: 8,
    })
  })
})

describe('Basalt Blackwell constraint', () => {
  const gpuSpec = BASALT_PARAMETERS.find((spec) => spec.key === 'gpu')
  const constraint = gpuSpec?.hardwareConstraint
  expect(constraint).toBeTypeOf('function')

  function profile(sm: number): HardwareProfile {
    return {
      gpu: { name: 'NVIDIA Blackwell', vramGiB: 32, sm },
      dockerAvailable: false,
      wsl2: false,
      os: 'linux',
      cpuThreads: 8,
    }
  }

  it('passes on a Blackwell card (SM 120)', () => {
    expect(constraint!('0', profile(120))).toEqual({ ok: true })
  })

  it('fires for a card below SM 120', () => {
    const result = constraint!('0', profile(89))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.severity).toBe('error')
      expect(result.message).toContain('SM 89')
    }
  })

  it('fires when no GPU is detected', () => {
    const noGpu: HardwareProfile = {
      dockerAvailable: false,
      wsl2: false,
      os: 'linux',
      cpuThreads: 8,
    }
    const result = constraint!('0', noGpu)
    expect(result.ok).toBe(false)
  })
})

describe('Basalt OS profiles', () => {
  it('spells the README CMake commands for the Linux and Windows routes', () => {
    // The Linux route also chains the serve/ server pip requirements after the
    // build, so the launch's health poll does not time out on a missing module
    // import.
    expect(BASALT_LINUX.buildSteps).toEqual([
      'cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j && sudo python3 -m pip install -r {dir}/requirements.txt',
    ])
    // The Windows route adds the Ninja generator and runs in the MSVC
    // developer shell (vcvars64.bat) so cl, cmake, and ninja are on the path.
    expect(BASALT_WINDOWS.buildSteps).toHaveLength(1)
    expect(BASALT_WINDOWS.buildSteps[0]).toContain('-G Ninja')
    expect(BASALT_WINDOWS.buildSteps[0]).toContain('vcvars64.bat')
    expect(BASALT_WINDOWS.buildSteps[0]).toContain(
      'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release',
    )
    expect(BASALT_WINDOWS.buildSteps[0]).toContain('cmake --build {dir}/build -j')
  })

  it('leaves the binary in the bin directory with the per-OS name', () => {
    // CMake sets RUNTIME_OUTPUT_DIRECTORY to the repo's bin/ folder, so the
    // profile's buildDir names bin/, not the CMake build/ tree.
    expect(BASALT_LINUX.buildDir).toBe('bin')
    expect(BASALT_LINUX.binary).toBe('basalt')
    expect(BASALT_WINDOWS.buildDir).toBe('bin')
    expect(BASALT_WINDOWS.binary).toBe('basalt.exe')
  })

  it('reuses the shared Linux route on macOS, where no Blackwell GPU exists', () => {
    expect(BASALT_MACOS).toBe(BASALT_LINUX)
  })

  it('rides the CUDA toolkit, the C++20 compiler, and the serve pip packages on the Linux toolchain', () => {
    const ids = BASALT_LINUX.deps?.map((dep) => dep.id) ?? []
    expect(ids).toEqual([
      'cmake',
      'compiler',
      'cuda-toolkit',
      'basalt-pip',
      'hf-cli',
    ])
  })

  it('rides Ninja, the MSVC workload, and the serve pip packages on the Windows toolchain', () => {
    const ids = BASALT_WINDOWS.deps?.map((dep) => dep.id) ?? []
    expect(ids).toEqual([
      'cmake',
      'ninja',
      'visual-studio',
      'cuda-toolkit',
      'basalt-pip',
      'hf-cli',
    ])
  })
})

describe('Basalt registration', () => {
  it('ships the ENGINES entry as local-build only, wired to the basalt surface', () => {
    const basalt = ENGINES.find((engine) => engine.id === 'basalt')
    expect(basalt).toBeDefined()
    expect(basalt?.supports).toEqual({ docker: false, local: true })
    expect(basalt?.parameters).toBe(BASALT_PARAMETERS)
  })

  it('resolves the upstream source and the per-OS profiles', () => {
    const source = engineSource('basalt')
    expect(source?.repo).toBe('https://github.com/jesdga95/basalt')
    expect(source?.branch).toBe('main')
    expect(engineOsProfile('basalt', 'linux')).toBe(BASALT_LINUX)
    expect(engineOsProfile('basalt', 'macos')).toBe(BASALT_MACOS)
    expect(engineOsProfile('basalt', 'windows')).toBe(BASALT_WINDOWS)
  })

  it('carries the single default model the adapter constants name', () => {
    const models = defaultModelsForEngine('basalt')
    expect(models).toHaveLength(1)
    expect(models[0]?.url).toBe(`https://huggingface.co/${BASALT_MODEL_REPO}`)
    expect(models[0]?.file).toBe(BASALT_MODEL_FILE)
  })

  it('registers the basalt adapter with the provider seam', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferProviders)
    // A duplicate id registration throws, so basalt in the list proves the
    // adapter registered without colliding with the five engines ahead of it.
    const ids = ctx.localInfer.registeredEngines().map((engine) => engine.id)
    expect(ids).toContain('basalt')
  })
})

describe('Basalt VRAM, guideline, and preset data', () => {
  it('registers the Qwen3.8-Flash-Next artifact as an estimated VRAM model', () => {
    expect(BASALT_VRAM_MODELS.map((model) => model.id)).toEqual(['qwen38-flash-next'])
    for (const model of BASALT_VRAM_MODELS) {
      // The measured figures are not yet available, so the model is flagged
      // estimated and the meter never reads it as authoritative.
      expect(model.source).toBe('estimated')
    }
    expect(basaltVramModel('qwen38-flash-next')?.id).toBe('qwen38-flash-next')
    expect(basaltVramModel('qwen3-27b')).toBeUndefined()
  })

  it('fires the basalt-needs-blackwell guideline only off an sm_120 card', () => {
    const rule = BUILTIN_GUIDELINES.find((guideline) => guideline.id === 'basalt-needs-blackwell')
    expect(rule).toBeDefined()
    expect(rule?.level).toBe('error')
    const sm86: HardwareProfile = {
      gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
      dockerAvailable: false,
      wsl2: false,
      os: 'linux',
      cpuThreads: 8,
    }
    const sm120: HardwareProfile = {
      gpu: { name: 'NVIDIA Blackwell', vramGiB: 32, sm: 120 },
      dockerAvailable: false,
      wsl2: false,
      os: 'linux',
      cpuThreads: 8,
    }
    // A basalt config on a non-Blackwell card, or with no detected GPU, fires.
    expect(rule?.when({ engine: 'basalt' }, sm86)).toBe(true)
    expect(rule?.when({ engine: 'basalt' }, { ...sm86, gpu: undefined })).toBe(true)
    // A basalt config on an sm_120 card stays silent, and a non-basalt config
    // never fires the rule.
    expect(rule?.when({ engine: 'basalt' }, sm120)).toBe(false)
    expect(rule?.when({ engine: 'ninfer' }, sm86)).toBe(false)
  })

  it('ships the Basalt Blackwell long-context preset on the wildcard class', () => {
    const basalt = BUILTIN_PRESETS.filter((preset) => preset.engineId === 'basalt')
    expect(basalt).toHaveLength(1)
    const preset = basalt[0]
    // Basalt runs on any Blackwell card, so the preset is keyed to the
    // wildcard class, not a specific card.
    expect(preset?.modelId).toBe('qwen38-flash-next')
    expect(preset?.hardwareClass).toBe('*')
    expect(preset?.isDefault).toBe(true)
    expect(preset?.values).toMatchObject({ kv: 'int8', maxContext: 32768 })
  })
})

const ADAPTER_HW: HardwareProfile = {
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
}

/**
 * basaltStubHost is a stub LifecycleHost that records every run, writeFile,
 * and spawn call in a single ordered sequence, so the adapter's deploy step
 * can be asserted on without a real build, model download, or spawn.
 * `runOutput` feeds per-command stdout (the behind-check count) so the
 * conditional rebuild prices the checkout without a real git repo.
 */
function basaltStubHost() {
  const state = {
    sequence: [] as string[],
    run: [] as string[],
    writeFile: [] as { path: string; content: string }[],
    spawn: [] as { argv: string[]; env: Record<string, string>; cwd?: string }[],
    killed: [] as number[],
    runOutput: {} as Record<string, string>,
    // Command substrings that read as failures, so a test prices one failing
    // step (the model download) without failing the git sync.
    runFail: [] as string[],
    fetchStatus: 200,
    // A test-driven spawn handle (e.g. one whose hasExited reports the child
    // settled); undefined keeps the default live handle.
    spawnHandle: undefined as ProcessHandle | undefined,
  }
  const fails = (command: string): boolean => state.runFail.some((key) => command.includes(key))
  const host: LifecycleHost = {
    async run(command: string): Promise<CommandOutcome> {
      state.run.push(command)
      state.sequence.push(`run: ${command}`)
      return fails(command) ? { ok: false, detail: 'run failed' } : { ok: true }
    },
    async runStream(
      command: string,
      onOutput: (chunk: string) => void,
    ): Promise<CommandOutcome> {
      state.run.push(command)
      state.sequence.push(`run: ${command}`)
      const output =
        Object.entries(state.runOutput).find(([key]) => command.includes(key))?.[1] ?? ''
      if (output !== '') onOutput(output)
      return fails(command) ? { ok: false, detail: 'run failed' } : { ok: true }
    },
    spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle {
      state.spawn.push({ argv: [...argv], env: { ...env }, cwd })
      state.sequence.push(`spawn: ${argv.join(' ')}`)
      if (state.spawnHandle !== undefined) return state.spawnHandle
      return {
        pid: 4321,
        // A running engine that has printed output reads as starting.
        logs: 'loading model',
        kill: (): void => {
          state.killed.push(4321)
        },
        onExit: (): void => {},
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      state.writeFile.push({ path, content })
      state.sequence.push(`writeFile: ${path}`)
    },
    async fetch(): Promise<FetchResult> {
      return { status: state.fetchStatus, ok: state.fetchStatus === 200 }
    },
  }
  return { host, state }
}

/**
 * seededHubCache points HF_HUB_CACHE at a temp dir seeded with the basalt
 * model's content-addressed tree (the blobs store the presence check looks
 * for, plus a snapshot commit holding the .basalt file), so a hub-cache
 * layout deploy reads a deterministic tree, never the real cache. Returns
 * the hub root and a cleanup that restores the env and removes the dir.
 */
function seededHubCache(): { hub: string; cleanup: () => void } {
  const hub = mkdtempSync(join(tmpdir(), 'basalt-hub-'))
  const saved = process.env.HF_HUB_CACHE
  process.env.HF_HUB_CACHE = hub
  const modelDir = hubCacheModelDirectory(repoIdFromUrl(`https://huggingface.co/${BASALT_MODEL_REPO}`))
  mkdirSync(join(hub, modelDir, 'blobs'), { recursive: true })
  const snapshot = join(hub, modelDir, 'snapshots', 'c1')
  mkdirSync(snapshot, { recursive: true })
  writeFileSync(join(snapshot, BASALT_MODEL_FILE), 'weights')
  return {
    hub,
    cleanup: (): void => {
      if (saved === undefined) delete process.env.HF_HUB_CACHE
      else process.env.HF_HUB_CACHE = saved
      rmSync(hub, { recursive: true, force: true })
    },
  }
}

describe('BasaltAdapter.renderLaunch', () => {
  it('renders a serve process plan with the config file the surface renders', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    const config = {
      port: 8090,
      host: '127.0.0.1',
      gpu: '0,1',
      parallel: 2,
      vision: 'dynamic',
      model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt',
      kv: 'int8',
      maxContext: 32768,
      expertCache: 'auto',
      prefill: 'auto',
      residentExperts: true,
      spec: 8,
      modelDirectory: 'models',
    }
    const plan = adapter.renderLaunch(config, ADAPTER_HW)
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('basalt')
    expect(plan.port).toBe(8090)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8090/health')
    const argv = plan.argv ?? []
    // The binary is spelled as a build-tree relative path (CMake's bin/
    // output dir), so the deploy step joins it against the engine directory.
    expect(argv[0]).toBe(join('bin', 'basalt'))
    expect(argv).toContain('serve')
    expect(argv).toContain('--config')
    // The serve CLI requires --model and --engine-bin. The --model value is a
    // placeholder the deploy step resolves (TASK-004); the --engine-bin value
    // is the build-tree binary the first token names.
    expect(argv).toContain('--model')
    expect(argv).toContain('--engine-bin')
    expect(argv[argv.indexOf('--model') + 1]).toBe(
      join('models', 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt'),
    )
    expect(argv[argv.indexOf('--engine-bin') + 1]).toBe(join('bin', 'basalt'))
    // The plan stamps the resolved model value, so the deploy step downloads
    // exactly the file the --model flag points at without re-parsing the argv.
    expect(plan.modelFile).toBe('models/Qwen3.8-FN-NVFP4-DQ6_K.basalt')
    // The config file content is exactly what the surface renders, and the
    // path lands in the model directory.
    expect(plan.configFile?.content).toBe(configFileFromSpecs(BASALT_PARAMETERS, config, 'json'))
    const object = JSON.parse(plan.configFile?.content ?? '{}') as {
      server: Record<string, unknown>
      engine: Record<string, unknown>
    }
    expect(object.server.port).toBe(8090)
    expect(object.engine['max-context']).toBe(32768)
    expect(plan.configFile?.path).toBe(join('models', BASALT_CONFIG_FILE))
    expect(plan.modelDirectory).toBe('models')
  })

  it('writes the config file into the hub cache root for a bare config', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({}, ADAPTER_HW)
    // A bare config (no model directory) targets the hub cache, so the config
    // file lands in the hub cache root, and the launch runs on the CLI default
    // port.
    expect(plan.configFile?.path).toBe(join(hfHubCacheDirectory(), BASALT_CONFIG_FILE))
    expect(plan.modelDirectory).toBeUndefined()
    expect(plan.port).toBe(8080)
    // A bare config names no model, so the plan stamps the engine default
    // artifact for the deploy step to download.
    expect(plan.modelFile).toBe(BASALT_MODEL_FILE)
  })

  it('maps a registry-key model value to its artifact file name', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // A registry key (the Model dropdown's default-model selection) maps to
    // the default model entry's artifact file through the default list.
    const keyed = adapter.renderLaunch({ model: 'qwen38-flash-next' }, ADAPTER_HW)
    expect(keyed.modelFile).toBe(BASALT_MODEL_FILE)
    // A .basalt file name (a directory-scan selection) passes through, and
    // the --model flag points at it in the model directory.
    const file = adapter.renderLaunch({ model: 'models/m.basalt', modelDirectory: 'models' }, ADAPTER_HW)
    expect(file.modelFile).toBe('models/m.basalt')
    expect(file.argv?.[file.argv?.indexOf('--model') + 1]).toBe(join('models', 'models/m.basalt'))
    // A value that is neither a .basalt name nor a known registry key falls
    // back to the engine default artifact.
    const unknown = adapter.renderLaunch({ model: 'not-a-key' }, ADAPTER_HW)
    expect(unknown.modelFile).toBe(BASALT_MODEL_FILE)
  })

  it('spells the Windows binary on a Windows host', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    const windows: HardwareProfile = { ...ADAPTER_HW, os: 'windows' }
    const plan = adapter.renderLaunch({}, windows)
    expect(plan.argv?.[0]).toBe(join('bin', 'basalt.exe'))
  })
})

describe('BasaltAdapter.deploy', () => {
  it('builds, downloads the model, writes the config, and spawns in order', async () => {
    const { host, state } = basaltStubHost()
    // The checkout is behind the remote branch, so the conditional rebuild
    // runs the build steps.
    state.runOutput['rev-list'] = '3'
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt', modelDirectory: 'models' },
      ADAPTER_HW,
    )
    const result = await adapter.deploy(plan, {
      engineId: 'basalt',
      engineDirectory: '/src/basalt',
    })
    expect(result.ok).toBe(true)
    expect(result.handle).toBeDefined()
    // The build step, the model download, the config write, and the spawn
    // fire in order.
    const buildIndex = state.sequence.findIndex((entry) => entry.includes('cmake -S /src/basalt'))
    const downloadIndex = state.sequence.findIndex((entry) =>
      entry.includes(`hf download ${BASALT_MODEL_REPO} ${BASALT_MODEL_FILE}`),
    )
    const writeIndex = state.sequence.findIndex((entry) => entry.startsWith('writeFile:'))
    const spawnIndex = state.sequence.findIndex((entry) => entry.startsWith('spawn:'))
    expect(buildIndex).toBeGreaterThan(-1)
    expect(downloadIndex).toBeGreaterThan(buildIndex)
    expect(writeIndex).toBeGreaterThan(downloadIndex)
    expect(spawnIndex).toBeGreaterThan(writeIndex)
    // The download targets the model directory, and the config write carries
    // the rendered content at the model-directory path.
    expect(state.run).toContain(
      `hf download ${BASALT_MODEL_REPO} ${BASALT_MODEL_FILE} --local-dir models --format human`,
    )
    // The config path is the model download target base directory joined with
    // the config file name (the flat --local-dir layout), written as-is.
    expect(state.writeFile).toHaveLength(1)
    expect(state.writeFile[0]?.path).toBe(join('models', BASALT_CONFIG_FILE))
    // The spawn runs the serve command with the config, model, and engine-bin
    // flags, in the engine directory. The first token is the build-tree path
    // joined against the engine directory (CMake's bin/ output dir), so the
    // spawn resolves the real binary without the PATH. The --model value is
    // the concrete artifact path the deploy step resolves (the flat join, where
    // the download lands); the --engine-bin value is the build-tree binary the
    // first token names.
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.argv).toEqual([
      join('/src/basalt', 'bin', 'basalt'),
      'serve',
      '--config',
      join('models', BASALT_CONFIG_FILE),
      '--model',
      join('models', 'Qwen3.8-FN-NVFP4-DQ6_K.basalt'),
      '--engine-bin',
      join('bin', 'basalt'),
    ])
    expect(state.spawn[0]?.cwd).toBe('/src/basalt')
    // The rebuild decision and output ride the result logs.
    expect(result.logs).toContain('is behind origin/main')
    expect(result.logs).toContain('cmake -S /src/basalt')
  })

  it('skips the git sync when autoRebuild is off', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '3'
    const adapter = new BasaltAdapter(host)
    // An overridden (absent) model directory keeps the presence check off the
    // real hub cache, so the model download runs deterministically.
    const plan = adapter.renderLaunch({ port: 8090, modelDirectory: 'models' }, ADAPTER_HW)
    const result = await adapter.deploy(
      plan,
      { engineId: 'basalt', engineDirectory: '/src/basalt' },
      undefined,
      { autoRebuild: false },
    )
    expect(result.ok).toBe(true)
    // No git sync and no build when the Auto Rebuild checkbox is off, but the
    // model download and the spawn still run.
    expect(state.run).not.toContain('git -C /src/basalt rev-parse --is-inside-work-tree')
    expect(state.run.some((c) => c.includes('cmake -S /src/basalt'))).toBe(false)
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
  })

  it('resolves a relative build-tree binary against the engine directory', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    const adapter = new BasaltAdapter(host)
    // A relative launch path (a build-tree binary, CMake's bin/ output dir)
    // is joined against the engine directory, so the spawn resolves an
    // absolute path. The named model directory keeps the model presence
    // check off the real hub cache (the flat layout is deterministic), so
    // the test is hermetic on a clean runner.
    const relativeBinary = join('bin', 'basalt')
    const plan: LaunchPlan = {
      engineId: 'basalt',
      kind: 'process',
      argv: [relativeBinary, 'serve', '--config', BASALT_CONFIG_FILE],
      env: {},
      port: 8090,
      healthUrl: 'http://127.0.0.1:8090/health',
      modelDirectory: 'models',
      configFile: { path: BASALT_CONFIG_FILE, content: '{}' },
    }
    const result = await adapter.deploy(plan, {
      engineId: 'basalt',
      engineDirectory: '/src/basalt',
    })
    expect(result.ok).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.argv[0]).toBe(join('/src/basalt', relativeBinary))
  })

  it('fails the launch when the model download fails', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    // The hf download is the only command that fails, so the launch aborts
    // before the config write and the spawn. An overridden (absent) model
    // directory keeps the presence check off the real hub cache, so the
    // download runs and fails deterministically.
    state.runFail.push('hf download')
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090, modelDirectory: 'models' }, ADAPTER_HW)
    const result = await adapter.deploy(plan, {
      engineId: 'basalt',
      engineDirectory: '/src/basalt',
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('model download failed')
    // The config write and the spawn never run after a failed download.
    expect(state.writeFile).toHaveLength(0)
    expect(state.spawn).toHaveLength(0)
  })

  it('resolves the hub-cache layout --model flag to the seeded snapshot path', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    const { hub, cleanup } = seededHubCache()
    try {
      const adapter = new BasaltAdapter(host)
      // A bare config (no model directory) targets the hub cache, so the
      // deploy resolves the --model placeholder to the snapshot path the
      // seeded tree holds.
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      // The seeded artifact is on disk, so the deploy skips the download.
      expect(state.run.some((command) => command.includes('hf download'))).toBe(false)
      // The --model flag resolves to the snapshot path, and the config write
      // lands in the hub cache root.
      expect(state.spawn).toHaveLength(1)
      expect(state.spawn[0]?.argv).toEqual([
        join('/src/basalt', 'bin', 'basalt'),
        'serve',
        '--config',
        join(hub, BASALT_CONFIG_FILE),
        '--model',
        join(hub, 'models--jesdga--Qwen3.8-Flash-Next-Basalt', 'snapshots', 'c1', BASALT_MODEL_FILE),
        '--engine-bin',
        join('bin', 'basalt'),
      ])
      expect(state.writeFile).toHaveLength(1)
      expect(state.writeFile[0]?.path).toBe(join(hub, BASALT_CONFIG_FILE))
    } finally {
      cleanup()
    }
  })

  it('writes the config file into the hub cache root, never the engine directory', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    const { hub, cleanup } = seededHubCache()
    try {
      const adapter = new BasaltAdapter(host)
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      // The Get step's dirty-check scenario: the config write lands in the
      // model download target directory (the hub cache root for the default
      // layout), so the engine's git checkout carries no basalt_config.json.
      expect(state.writeFile).toHaveLength(1)
      expect(state.writeFile[0]?.path).toBe(join(hub, BASALT_CONFIG_FILE))
      expect(state.writeFile[0]?.path.startsWith('/src/basalt')).toBe(false)
    } finally {
      cleanup()
    }
  })
})

describe('BasaltAdapter.healthCheck', () => {
  it('reports ready when the health URL returns 200', async () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 1 })
    expect(result.healthy).toBe(true)
    expect(result.state).toBe('ready')
  })

  it('reports the start phase from the tracked process output', async () => {
    const { host, state } = basaltStubHost()
    state.fetchStatus = 503
    const adapter = new BasaltAdapter(host)
    // The named model directory keeps the deploy's model presence check off
    // the real hub cache, so the test is hermetic on a clean runner.
    const plan = adapter.renderLaunch({ port: 8090, modelDirectory: 'models' }, ADAPTER_HW)
    // A tracked process that has output reads as starting (in progress), not
    // failed.
    await adapter.deploy(plan, { engineId: 'basalt', engineDirectory: '/src/basalt' })
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 1 })
    expect(result.healthy).toBe(false)
    expect(result.state).toBe('starting')
  })

  it('reports failed when no process is tracked', async () => {
    const { host } = basaltStubHost()
    host.fetch = async () => ({ status: 503, ok: false })
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
    // No deploy tracked a process, so a down health URL reads as failed.
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 1 })
    expect(result.healthy).toBe(false)
    expect(result.state).toBe('failed')
  })

  it('reports failed immediately when the tracked child has exited', async () => {
    const { host, state } = basaltStubHost()
    state.fetchStatus = 503
    // The tracked child settled (a crash), so the health poll ends before the
    // first fetch and the health check reads as failed, not starting.
    state.spawnHandle = {
      pid: 4321,
      logs: 'loading model',
      kill: (): void => {
        state.killed.push(4321)
      },
      onExit: (): void => {},
      hasExited: (): boolean => true,
    }
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090, modelDirectory: 'models' }, ADAPTER_HW)
    await adapter.deploy(plan, { engineId: 'basalt', engineDirectory: '/src/basalt' })
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 5 })
    expect(result.healthy).toBe(false)
    expect(result.state).toBe('failed')
    expect(result.detail).toBe('the engine process exited before it reported ready')
  })
})

describe('BasaltAdapter.stop', () => {
  it('signals the tracked handle and drops the entry', async () => {
    const { host, state } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // The named model directory keeps the deploy's model presence check off
    // the real hub cache, so the test is hermetic on a clean runner.
    const plan = adapter.renderLaunch({ port: 8090, modelDirectory: 'models' }, ADAPTER_HW)
    const result = await adapter.deploy(plan, {
      engineId: 'basalt',
      engineDirectory: '/src/basalt',
    })
    expect(result.ok).toBe(true)
    await adapter.stop(plan)
    expect(state.killed).toEqual([4321])
    // A second stop finds no tracked handle, so it is a no-op.
    await adapter.stop(plan)
    expect(state.killed).toEqual([4321])
  })

  it('signals the plan pid when no tracked child exists (a re-adopted engine)', async () => {
    const { host, state } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // No deploy ran, so the adapter tracks no child: the stop reaches the
    // process a DSH restart re-adopted through the pid the record stamped.
    const plan = { ...adapter.renderLaunch({ port: 8090 }, ADAPTER_HW), pid: 777 }
    await adapter.stop(plan)
    expect(state.run).toContain('kill 777')
    expect(state.killed).toEqual([])
  })

  it('throws with the host detail when the pid kill fails', async () => {
    const { host, state } = basaltStubHost()
    state.runFail.push('kill 777')
    const adapter = new BasaltAdapter(host)
    const plan = { ...adapter.renderLaunch({ port: 8090 }, ADAPTER_HW), pid: 777 }
    await expect(adapter.stop(plan)).rejects.toThrow('stop: signal pid 777 failed: run failed')
  })
})

describe('BasaltAdapter model data', () => {
  it('publishes the model path the config names, falling back to the engine name', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    expect(adapter.modelRef({ model: 'models/m.basalt' })).toEqual({
      id: 'models/m.basalt',
      name: 'models/m.basalt',
    })
    expect(adapter.modelRef({})).toEqual({ id: 'basalt', name: 'Basalt' })
  })

  it('withholds the image input only when vision is off or unset', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    expect(adapter.modelInput({ vision: 'off' })).toEqual(['text'])
    expect(adapter.modelInput({})).toEqual(['text'])
    expect(adapter.modelInput({ vision: 'dynamic' })).toEqual(['text', 'image'])
    expect(adapter.modelInput({ vision: 'cpu' })).toEqual(['text', 'image'])
    // A pinned GPU number (a string or a number) enables the image input.
    expect(adapter.modelInput({ vision: '2' })).toEqual(['text', 'image'])
    expect(adapter.modelInput({ vision: 2 })).toEqual(['text', 'image'])
  })

  it('signs the launch with the basalt binary and the port', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    expect(adapter.launchSignature({ port: 8090 })).toEqual({ binary: 'basalt', port: 8090 })
    expect(adapter.launchSignature({})).toEqual({ binary: 'basalt', port: 8080 })
  })
})
