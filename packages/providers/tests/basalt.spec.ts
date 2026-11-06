import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LocalInfer from 'dsh-plugin-local-infer/service'
import {
  dshConfigCacheDirectory,
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
  BASALT_CONFIG_VERSION,
  BASALT_DEFAULT_MODEL_ID,
  BASALT_DEEPSEEK_MODEL_FILE,
  BASALT_DEEPSEEK_MODEL_ID,
  BASALT_DEEPSEEK_MODEL_REPO,
  BASALT_DEEPSEEK_SERVED_MODEL_ID,
  BASALT_EXPERT_CACHE_OPTIONS,
  BASALT_KV_OPTIONS,
  BASALT_PARAMETERS,
  BASALT_SERVED_MODEL_ID,
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

  it('gives every spec a config deploy target in the server, models, or engine block', () => {
    const byKey = Object.fromEntries(BASALT_PARAMETERS.map((spec) => [spec.key, spec]))
    // The shared server options nest under `server` in basalt_config.json.
    for (const key of ['port', 'host']) {
      expect(byKey[key]?.deploy).toEqual({ target: 'config', format: 'json', block: 'server' })
    }
    // The per-model settings merge into the single `models` array entry; the
    // maxContext key names its dash flag spelling in `deploy.key`.
    for (const key of ['gpu', 'parallel', 'vision', 'model']) {
      expect(byKey[key]?.deploy).toEqual({ target: 'config', format: 'json', block: 'models[]' })
    }
    expect(byKey['maxContext']?.deploy).toEqual({
      target: 'config',
      format: 'json',
      block: 'models[]',
      key: 'max-context',
    })
    // The shared engine flags nest under `engine`; the multi-word keys name
    // their dash flag spelling in `deploy.key`.
    expect(byKey['kv']?.deploy).toEqual({ target: 'config', format: 'json', block: 'engine' })
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

  it('renders a representative config into a { server, models, engine } JSON object', () => {
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
    const object = JSON.parse(content) as {
      server: Record<string, unknown>
      models: Record<string, unknown>[]
      engine: Record<string, unknown>
    }
    // The shared server options nest under `server`.
    expect(object.server).toEqual({ port: 8090, host: '127.0.0.1' })
    // The per-model settings merge into the one `models` entry, the
    // multi-word key under its dash flag spelling.
    expect(object.models).toHaveLength(1)
    expect(object.models[0]).toEqual({
      gpu: '0,1',
      parallel: 2,
      vision: 'dynamic',
      model: 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt',
      'max-context': 32768,
    })
    // The shared engine flags nest under `engine`, the multi-word keys under
    // their dash flag spellings.
    expect(object.engine).toEqual({
      kv: 'int8',
      'expert-cache': 'auto',
      prefill: 'auto',
      'resident-experts': true,
      spec: 8,
    })
  })

  it('renders the spec defaults for unset settings and omits the defaultless gpu', () => {
    // Only the model and the kv format are set. Every spec that declares a
    // defaultValue renders that default; gpu has no default and is unset, so
    // it stays out of the models entry and the engine picks the card itself.
    const content = configFileFromSpecs(BASALT_PARAMETERS, { model: 'm.basalt', kv: 'int8' }, 'json')
    const object = JSON.parse(content) as {
      server: Record<string, unknown>
      models: Record<string, unknown>[]
      engine: Record<string, unknown>
    }
    expect(object.server).toEqual({ port: 8080, host: '127.0.0.1' })
    expect(object.models).toHaveLength(1)
    expect(object.models[0]).toEqual({
      parallel: 1,
      vision: 'off',
      model: 'm.basalt',
      'max-context': 4096,
    })
    expect(object.engine).toEqual({
      kv: 'int8',
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
    // The Linux route is the CMake build alone; the serve/ server pip
    // requirements ride the basaltPip prereq dep (fc68df6), not the build step.
    expect(BASALT_LINUX.buildSteps).toEqual([
      'cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
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

  it('carries the two default models the adapter constants name', () => {
    const models = defaultModelsForEngine('basalt')
    expect(models).toHaveLength(2)
    expect(models.map((model) => model.modelId)).toEqual([
      BASALT_DEFAULT_MODEL_ID,
      BASALT_DEEPSEEK_MODEL_ID,
    ])
    // Each artifact downloads from its own repo, named by the constants.
    expect(models[0]?.url).toBe(`https://huggingface.co/${BASALT_MODEL_REPO}`)
    expect(models[0]?.file).toBe(BASALT_MODEL_FILE)
    expect(models[1]?.url).toBe(`https://huggingface.co/${BASALT_DEEPSEEK_MODEL_REPO}`)
    expect(models[1]?.file).toBe(BASALT_DEEPSEEK_MODEL_FILE)
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
  it('registers both .basalt artifacts as estimated VRAM models', () => {
    expect(BASALT_VRAM_MODELS.map((model) => model.id)).toEqual([
      'qwen38-flash-next',
      'deepseek-v41-flash',
    ])
    for (const model of BASALT_VRAM_MODELS) {
      // The measured figures are not yet available, so the model is flagged
      // estimated and the meter never reads it as authoritative.
      expect(model.source).toBe('estimated')
    }
    expect(basaltVramModel('qwen38-flash-next')?.id).toBe('qwen38-flash-next')
    expect(basaltVramModel('deepseek-v41-flash')?.id).toBe('deepseek-v41-flash')
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

  it('ships a Basalt Blackwell long-context preset per model on the wildcard class', () => {
    const basalt = BUILTIN_PRESETS.filter((preset) => preset.engineId === 'basalt')
    expect(basalt).toHaveLength(2)
    const qwen = basalt[0]
    // Basalt runs on any Blackwell card, so the preset is keyed to the
    // wildcard class, not a specific card.
    expect(qwen?.modelId).toBe('qwen38-flash-next')
    expect(qwen?.hardwareClass).toBe('*')
    expect(qwen?.isDefault).toBe(true)
    expect(qwen?.values).toMatchObject({ kv: 'int8', maxContext: 32768 })
    // The DeepSeek row is its model's default too (rows are keyed by the
    // engine/model/class triple), and it carries no kv: the pack has no
    // KV-format choice.
    const deepseek = basalt[1]
    expect(deepseek?.modelId).toBe('deepseek-v41-flash')
    expect(deepseek?.hardwareClass).toBe('*')
    expect(deepseek?.isDefault).toBe(true)
    expect(deepseek?.values).toEqual({ maxContext: 32768 })
  })
})

const ADAPTER_HW: HardwareProfile = {
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
}

/**
 * basaltConfigPath is the config file path every renderLaunch expects: the
 * plugin config cache home in the per-engine subdirectory, composed with the
 * shared builder the adapter itself consumes (never a restated literal).
 */
function basaltConfigPath(): string {
  return join(dshConfigCacheDirectory(), 'basalt', BASALT_CONFIG_FILE)
}

/**
 * modelEntryPath reads the `model` value out of the single entry of a plan's
 * rendered config envelope, so the specs assert on the absolute artifact
 * path the entry carries (the renderLaunch placeholder, restamped to the
 * concrete path by the deploy step).
 */
function modelEntryPath(plan: LaunchPlan): unknown {
  const envelope = JSON.parse(plan.configFile?.content ?? '{}') as {
    models?: Record<string, unknown>[]
  }
  return envelope.models?.[0]?.model
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
    // An optional effect the host runs per command, so a test lets the stub
    // hf download complete the fetch on disk (write the snapshot links an
    // interrupted download never left) inside the deploy's own timeline.
    runEffect: undefined as ((command: string) => void) | undefined,
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
      if (fails(command)) return { ok: false, detail: 'run failed' }
      state.runEffect?.(command)
      return { ok: true }
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
      if (fails(command)) return { ok: false, detail: 'run failed' }
      state.runEffect?.(command)
      return { ok: true }
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
 * model's content-addressed tree (the blobs store plus, unless `snapshot`
 * is false, a snapshot commit holding the .basalt file), so a hub-cache
 * layout deploy reads a deterministic tree, never the real cache. The
 * snapshot-less form stands in for a download interrupted before the
 * snapshot links were written. Returns the hub root, the snapshot artifact
 * path (whether or not it was seeded), and a cleanup that restores the env
 * and removes the dir.
 */
function seededHubCache(options?: {
  snapshot?: boolean
}): { hub: string; snapshot: string; cleanup: () => void } {
  const withSnapshot = options?.snapshot ?? true
  const hub = mkdtempSync(join(tmpdir(), 'basalt-hub-'))
  const saved = process.env.HF_HUB_CACHE
  process.env.HF_HUB_CACHE = hub
  const modelDir = hubCacheModelDirectory(repoIdFromUrl(`https://huggingface.co/${BASALT_MODEL_REPO}`))
  mkdirSync(join(hub, modelDir, 'blobs'), { recursive: true })
  const snapshotDir = join(hub, modelDir, 'snapshots', 'c1')
  if (withSnapshot) {
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(join(snapshotDir, BASALT_MODEL_FILE), 'weights')
  }
  return {
    hub,
    snapshot: join(snapshotDir, BASALT_MODEL_FILE),
    cleanup: (): void => {
      if (saved === undefined) delete process.env.HF_HUB_CACHE
      else process.env.HF_HUB_CACHE = saved
      rmSync(hub, { recursive: true, force: true })
    },
  }
}

describe('BasaltAdapter.renderLaunch', () => {
  it('renders a serve process plan with the v2 config envelope the surface renders', () => {
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
    // The serve CLI takes every setting and the model from the config file;
    // the CLI-only --engine-bin flag pins the build-tree binary the first
    // token names, and no --model flag rides the argv (upstream rejects the
    // pair beside --config).
    expect(argv).toEqual([
      join('bin', 'basalt'),
      'serve',
      '--config',
      basaltConfigPath(),
      '--engine-bin',
      join('bin', 'basalt'),
    ])
    // The plan stamps the resolved model value, so the deploy step downloads
    // exactly the file the config entry names without re-parsing the file.
    expect(plan.modelFile).toBe('models/Qwen3.8-FN-NVFP4-DQ6_K.basalt')
    // The config file lands in the plugin config cache home, not the model
    // directory the config was rendered with.
    expect(plan.configFile?.path).toBe(basaltConfigPath())
    expect(plan.modelDirectory).toBe('models')
    // The config file is the v2 envelope: the version stamp plus the blocks
    // the surface renders, in the upstream key order, with the models entry
    // carrying the placeholder path the deploy step later resolves and the
    // deterministic served alias for the bundled artifact.
    const envelope = JSON.parse(plan.configFile?.content ?? '{}') as {
      version: number
      server: Record<string, unknown>
      models: Record<string, unknown>[]
      engine: Record<string, unknown>
    }
    expect(Object.keys(envelope)).toEqual(['version', 'models', 'engine', 'server'])
    expect(envelope.version).toBe(BASALT_CONFIG_VERSION)
    expect(envelope.server).toEqual({ port: 8090, host: '127.0.0.1' })
    expect(envelope.models).toEqual([
      {
        gpu: '0,1',
        parallel: 2,
        vision: 'dynamic',
        model: join('models', 'models/Qwen3.8-FN-NVFP4-DQ6_K.basalt'),
        'max-context': 32768,
        alias: BASALT_SERVED_MODEL_ID,
      },
    ])
    expect(envelope.engine).toEqual({
      kv: 'int8',
      'expert-cache': 'auto',
      prefill: 'auto',
      'resident-experts': true,
      spec: 8,
    })
  })

  it('lands the config file in the plugin config cache for a bare config', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    const plan = adapter.renderLaunch({}, ADAPTER_HW)
    // A bare config (no model directory) targets the hub cache for the model
    // artifact, but the config file always lands in the plugin config cache
    // home, and the launch runs on the CLI default port.
    expect(plan.configFile?.path).toBe(basaltConfigPath())
    expect(plan.modelDirectory).toBeUndefined()
    expect(plan.port).toBe(8080)
    // A bare config names no model, so the plan stamps the engine default
    // artifact for the deploy step to download. Upstream refuses a models
    // entry without a `model`, so the envelope's entry carries the
    // placeholder path into the hub cache root even here.
    expect(plan.modelFile).toBe(BASALT_MODEL_FILE)
    expect(modelEntryPath(plan)).toBe(join(hfHubCacheDirectory(), BASALT_MODEL_FILE))
  })

  it('maps a registry-key model value to its artifact file name', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // A registry key (the Model dropdown's default-model selection) maps to
    // the default model entry's artifact file through the default list, and
    // the config entry names it at the download target, never the raw key.
    const keyed = adapter.renderLaunch({ model: 'qwen38-flash-next' }, ADAPTER_HW)
    expect(keyed.modelFile).toBe(BASALT_MODEL_FILE)
    expect(modelEntryPath(keyed)).toBe(join(hfHubCacheDirectory(), BASALT_MODEL_FILE))
    // A .basalt file name (a directory-scan selection) passes through, and
    // the config entry points at it in the model directory.
    const file = adapter.renderLaunch(
      { model: 'models/m.basalt', modelDirectory: 'models' },
      ADAPTER_HW,
    )
    expect(file.modelFile).toBe('models/m.basalt')
    expect(modelEntryPath(file)).toBe(join('models', 'models/m.basalt'))
    // A value that is neither a .basalt name nor a known registry key falls
    // back to the engine default artifact.
    const unknown = adapter.renderLaunch({ model: 'not-a-key' }, ADAPTER_HW)
    expect(unknown.modelFile).toBe(BASALT_MODEL_FILE)
  })

  it('stamps the DeepSeek artifact placeholder and served alias for the DeepSeek key', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // The second model's registry key maps to the DeepSeek pack: the entry's
    // model placeholder names its artifact file at the download target, and
    // the alias is the name the API reports (the pack's stored meta.name is
    // not knowable to the plugin, so the alias pins it).
    const plan = adapter.renderLaunch({ model: BASALT_DEEPSEEK_MODEL_ID }, ADAPTER_HW)
    expect(plan.modelFile).toBe(BASALT_DEEPSEEK_MODEL_FILE)
    expect(plan.modelId).toBe(BASALT_DEEPSEEK_MODEL_ID)
    expect(modelEntryPath(plan)).toBe(join(hfHubCacheDirectory(), BASALT_DEEPSEEK_MODEL_FILE))
    const envelope = JSON.parse(plan.configFile?.content ?? '{}') as {
      models?: Record<string, unknown>[]
    }
    expect(envelope.models?.[0]?.alias).toBe(BASALT_DEEPSEEK_SERVED_MODEL_ID)
    // The bundled Qwen key keeps today's served alias, so nothing
    // user-visible moves for the existing artifact.
    const qwen = adapter.renderLaunch({ model: BASALT_DEFAULT_MODEL_ID }, ADAPTER_HW)
    const qwenEnvelope = JSON.parse(qwen.configFile?.content ?? '{}') as {
      models?: Record<string, unknown>[]
    }
    expect(qwenEnvelope.models?.[0]?.alias).toBe(BASALT_SERVED_MODEL_ID)
  })

  it('stamps the plan modelId from the raw config model for the status tie', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // The raw config.model value stamps the plan, so the service's
    // launched-models tie compares equal against the provider's stored
    // config.model. A registry key (the Model dropdown's selection) stamps
    // that key.
    const keyed = adapter.renderLaunch({ model: 'qwen38-flash-next' }, ADAPTER_HW)
    expect(keyed.modelId).toBe('qwen38-flash-next')
    // A .basalt file name (a directory-scan selection) stamps the path the
    // engine serves.
    const file = adapter.renderLaunch({ model: 'models/m.basalt' }, ADAPTER_HW)
    expect(file.modelId).toBe('models/m.basalt')
    // A bare config names the engine's single default model.
    const bare = adapter.renderLaunch({}, ADAPTER_HW)
    expect(bare.modelId).toBe(BASALT_DEFAULT_MODEL_ID)
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
    // the rendered content.
    expect(state.run).toContain(
      `hf download ${BASALT_MODEL_REPO} ${BASALT_MODEL_FILE} --local-dir models --format human`,
    )
    // The config path is the plugin config cache home in the per-engine
    // subdirectory, never the model directory the plan carries.
    expect(state.writeFile).toHaveLength(1)
    expect(state.writeFile[0]?.path).toBe(basaltConfigPath())
    // The written envelope carries the downloaded artifact path resolved
    // into the models entry (the flat --local-dir join), replacing the
    // renderLaunch placeholder.
    const written = JSON.parse(state.writeFile[0]?.content ?? '{}') as {
      models?: Record<string, unknown>[]
    }
    expect(written.models?.[0]?.model).toBe(join('models', 'Qwen3.8-FN-NVFP4-DQ6_K.basalt'))
    // The spawn runs the serve command with the config and engine-bin flags,
    // in the engine directory. The first token is the build-tree path joined
    // against the engine directory (CMake's bin/ output dir), so the spawn
    // resolves the real binary without the PATH. The --engine-bin value is
    // the build-tree binary the first token names; the model rides the config
    // file's entry, so no --model flag rides the spawn.
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.argv).toEqual([
      join('/src/basalt', 'bin', 'basalt'),
      'serve',
      '--config',
      basaltConfigPath(),
      '--engine-bin',
      join('bin', 'basalt'),
    ])
    expect(state.spawn[0]?.cwd).toBe('/src/basalt')
    // The rebuild decision and output ride the result logs.
    expect(result.logs).toContain('is behind origin/main')
    expect(result.logs).toContain('cmake -S /src/basalt')
  })

  it('downloads the DeepSeek artifact from its own repo', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    const adapter = new BasaltAdapter(host)
    // The DeepSeek pack lives on its own repo: the deploy resolves the
    // download entry through the default model list, so the hf command names
    // the DeepSeek repo and file, not the bundled Qwen repo.
    const plan = adapter.renderLaunch(
      { port: 8090, model: BASALT_DEEPSEEK_MODEL_ID, modelDirectory: 'models' },
      ADAPTER_HW,
    )
    const result = await adapter.deploy(plan, {
      engineId: 'basalt',
      engineDirectory: '/src/basalt',
    })
    expect(result.ok).toBe(true)
    expect(state.run).toContain(
      `hf download ${BASALT_DEEPSEEK_MODEL_REPO} ${BASALT_DEEPSEEK_MODEL_FILE} --local-dir models --format human`,
    )
    // The written entry carries the DeepSeek artifact's flat join and keeps
    // the deterministic alias through the deploy restamp.
    const written = JSON.parse(state.writeFile[0]?.content ?? '{}') as {
      models?: Record<string, unknown>[]
    }
    expect(written.models?.[0]?.model).toBe(join('models', BASALT_DEEPSEEK_MODEL_FILE))
    expect(written.models?.[0]?.alias).toBe(BASALT_DEEPSEEK_SERVED_MODEL_ID)
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
    // The hand-built content is not a v2 envelope, so the artifact swap
    // leaves it untouched: the config is written verbatim.
    expect(state.writeFile[0]?.content).toBe('{}')
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

  it('skips the download and spawns serve for a seeded hub-cache artifact', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    const { snapshot, cleanup } = seededHubCache()
    try {
      const adapter = new BasaltAdapter(host)
      // A bare config (no model directory) targets the hub cache, so the
      // deploy reads the seeded artifact as present and skips the download.
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      // The seeded artifact is on disk, so the deploy skips the download.
      expect(state.run.some((command) => command.includes('hf download'))).toBe(false)
      // The spawn runs the config-carried serve command with the
      // engine-directory-joined binary (the model rides the config entry,
      // not the argv), and the config write lands in the plugin config cache.
      expect(state.spawn).toHaveLength(1)
      expect(state.spawn[0]?.argv).toEqual([
        join('/src/basalt', 'bin', 'basalt'),
        'serve',
        '--config',
        basaltConfigPath(),
        '--engine-bin',
        join('bin', 'basalt'),
      ])
      expect(state.writeFile).toHaveLength(1)
      expect(state.writeFile[0]?.path).toBe(basaltConfigPath())
      // The written config carries the hub-cache snapshot path in the models
      // entry: the artifact delivery the serve CLI resolves (no --model flag
      // rides the argv to carry it).
      const written = JSON.parse(state.writeFile[0]?.content ?? '{}') as {
        models?: Record<string, unknown>[]
      }
      expect(written.models?.[0]?.model).toBe(snapshot)
    } finally {
      cleanup()
    }
  })

  it('re-fetches into the hub cache when blobs survive without a snapshot', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    // A first download interrupted before the snapshot links were written
    // leaves only the blobs store, so the presence gate reads the artifact
    // as absent. The stub's runEffect stands in for the hf CLI completing
    // the fetch: it reuses the blobs and writes the snapshot links inside
    // the deploy's own timeline, so the later lookup resolves.
    const { snapshot, cleanup } = seededHubCache({ snapshot: false })
    state.runEffect = (command): void => {
      if (!command.includes('hf download')) return
      mkdirSync(snapshot.slice(0, snapshot.lastIndexOf('/')), { recursive: true })
      writeFileSync(snapshot, 'weights')
    }
    try {
      const adapter = new BasaltAdapter(host)
      // A bare config (no model directory) targets the hub cache, so the
      // deploy gates on the seeded tree.
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      // The blob-only cache fails the gate, so the hub-cache download runs
      // (no --local-dir), reusing the blobs to write the missing links.
      expect(state.run).toContain(
        `hf download ${BASALT_MODEL_REPO} ${BASALT_MODEL_FILE} --format human`,
      )
      // The completed fetch resolves: the config's models entry carries the
      // snapshot path the fetch wrote, not a dead-end failure.
      expect(state.writeFile).toHaveLength(1)
      const written = JSON.parse(state.writeFile[0]?.content ?? '{}') as {
        models?: Record<string, unknown>[]
      }
      expect(written.models?.[0]?.model).toBe(snapshot)
      expect(result.detail ?? '').not.toContain('no hub-cache snapshot')
    } finally {
      cleanup()
    }
  })

  it('writes the config file into the plugin config cache, never the model or engine dirs', async () => {
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
      // plugin config cache home (the per-engine subdirectory), so neither
      // the engine's git checkout nor the hub cache carries a
      // basalt_config.json.
      expect(state.writeFile).toHaveLength(1)
      expect(state.writeFile[0]?.path).toBe(basaltConfigPath())
      expect(state.writeFile[0]?.path.startsWith('/src/basalt')).toBe(false)
      expect(state.writeFile[0]?.path.startsWith(hub)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('writes the default-launch config under ~/.cache/dsh/infer/config, not the model dir', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    // The path builders key on homedir(), which reads HOME on POSIX and
    // USERPROFILE on Windows, so a default (bare-config) launch prices the
    // config home against a stub, never the real one. The seeded hub cache
    // pins HF_HUB_CACHE explicitly, so the model layout stays unaffected.
    const home = join(tmpdir(), 'basalt-stub-home')
    const savedHome = process.env.HOME
    const savedUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home
    const { cleanup } = seededHubCache()
    try {
      const adapter = new BasaltAdapter(host)
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      expect(state.writeFile).toHaveLength(1)
      const writtenPath = state.writeFile[0]?.path ?? ''
      expect(writtenPath).toBe(
        join(home, '.cache', 'dsh', 'infer', 'config', 'basalt', BASALT_CONFIG_FILE),
      )
      // The model directory (the hub cache for the default layout) carries
      // no config file.
      expect(writtenPath.startsWith(process.env.HF_HUB_CACHE ?? '')).toBe(false)
    } finally {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      if (savedUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = savedUserProfile
      cleanup()
    }
  })

  it('writes the resolved config content and spawn argv back onto the plan', async () => {
    const { host, state } = basaltStubHost()
    state.runOutput['rev-list'] = '0'
    // The seed keeps the bare-config deploy hermetic: the artifact is on
    // disk, so no download runs and the spawn is reached.
    const { snapshot, cleanup } = seededHubCache()
    try {
      const adapter = new BasaltAdapter(host)
      const plan = adapter.renderLaunch({ port: 8090 }, ADAPTER_HW)
      const result = await adapter.deploy(plan, {
        engineId: 'basalt',
        engineDirectory: '/src/basalt',
      })
      expect(result.ok).toBe(true)
      // The plan mirrors what deploy wrote and spawned: the config content
      // carries the snapshot artifact path in the models entry, and the argv
      // is exactly the spawn. The plan is the launch record's argv source,
      // and the re-link rule substring-matches every record argv token
      // against the live command line, so the record must name the spawn,
      // not the rendered build-tree relative path.
      expect(plan.configFile?.content).toBe(state.writeFile[0]?.content)
      const written = JSON.parse(plan.configFile?.content ?? '{}') as {
        models?: Record<string, unknown>[]
      }
      expect(written.models?.[0]?.model).toBe(snapshot)
      expect(plan.argv).toEqual(state.spawn[0]?.argv)
      expect(plan.argv?.[0]).toBe(join('/src/basalt', 'bin', 'basalt'))
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
  it('publishes the served model id for the bundled artifacts and the file name otherwise', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // The serve server answers to the config entry's alias (renderLaunch
    // stamps it from the same basaltServedName) beside the artifact file
    // name. The bare config, the registry key, and the bundled artifact
    // file name all pick the bundled artifact, so each publishes its served
    // id.
    const served = { id: BASALT_SERVED_MODEL_ID, name: BASALT_SERVED_MODEL_ID }
    expect(adapter.modelRef({})).toEqual(served)
    expect(adapter.modelRef({ model: BASALT_DEFAULT_MODEL_ID })).toEqual(served)
    expect(adapter.modelRef({ model: BASALT_MODEL_FILE })).toEqual(served)
    // The DeepSeek pack publishes its deterministic served id, not the
    // unknown meta.name stored in the pack.
    const deepseek = { id: BASALT_DEEPSEEK_SERVED_MODEL_ID, name: BASALT_DEEPSEEK_SERVED_MODEL_ID }
    expect(adapter.modelRef({ model: BASALT_DEEPSEEK_MODEL_ID })).toEqual(deepseek)
    expect(adapter.modelRef({ model: BASALT_DEEPSEEK_MODEL_FILE })).toEqual(deepseek)
    // A custom .basalt pick publishes its basename: the engine accepts the
    // artifact's own file name beside the served name.
    expect(adapter.modelRef({ model: 'models/m.basalt' })).toEqual({
      id: 'm.basalt',
      name: 'm.basalt',
    })
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

  it('signs the launch with the basalt binary and the config port carried outside argv', () => {
    const { host } = basaltStubHost()
    const adapter = new BasaltAdapter(host)
    // The serve CLI binds the port from the basalt_config.json server block,
    // so the signature declares portInArgv false while the port stays the
    // model-tie key. A bare config keeps the serve CLI default port.
    expect(adapter.launchSignature({ port: 8090 })).toEqual({
      binary: 'basalt',
      port: 8090,
      portInArgv: false,
    })
    expect(adapter.launchSignature({})).toEqual({
      binary: 'basalt',
      port: 8080,
      portInArgv: false,
    })
  })
})
