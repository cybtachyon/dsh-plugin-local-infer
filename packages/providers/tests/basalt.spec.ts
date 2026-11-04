import { describe, expect, it } from 'vitest'
import type { HardwareProfile } from 'dsh-plugin-local-infer/core'
import { configFileFromSpecs } from '../src/adapters.ts'
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

  it('leaves the binary in the build directory with the per-OS name', () => {
    expect(BASALT_LINUX.buildDir).toBe('build')
    expect(BASALT_LINUX.binary).toBe('basalt')
    expect(BASALT_WINDOWS.buildDir).toBe('build')
    expect(BASALT_WINDOWS.binary).toBe('basalt.exe')
  })

  it('reuses the shared Linux route on macOS, where no Blackwell GPU exists', () => {
    expect(BASALT_MACOS).toBe(BASALT_LINUX)
  })

  it('rides the CUDA toolkit and the C++20 compiler on the Linux toolchain', () => {
    const ids = BASALT_LINUX.deps?.map((dep) => dep.id) ?? []
    expect(ids).toEqual(['cmake', 'compiler', 'cuda-toolkit', 'python', 'hf-cli'])
  })

  it('rides Ninja and the MSVC workload on the Windows toolchain', () => {
    const ids = BASALT_WINDOWS.deps?.map((dep) => dep.id) ?? []
    expect(ids).toEqual([
      'cmake',
      'ninja',
      'visual-studio',
      'cuda-toolkit',
      'python',
      'hf-cli',
    ])
  })
})
