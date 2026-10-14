import { describe, expect, it } from 'vitest'
import {
  hardwareClass,
  presetFromFetch,
  resolveDefaults,
  WILDCARD_HARDWARE_CLASS,
} from '../src/index.ts'
import type {
  Config,
  HardwareProfile,
  ParameterSpec,
  Preset,
  PresetSource,
} from '../src/index.ts'

const HW_3090: HardwareProfile = {
  dockerAvailable: true,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
  gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
}
const HW_NO_GPU: HardwareProfile = {
  dockerAvailable: true,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
}

function spec(key: string, defaultValue?: unknown): ParameterSpec {
  const s: ParameterSpec = {
    key,
    label: key,
    description: `The ${key} knob.`,
    form: { kind: 'boolean' },
  }
  if (defaultValue !== undefined) {
    s.defaultValue = defaultValue
  }
  return s
}

function preset(
  engineId: string,
  modelId: string,
  hardwareClass: string,
  values: Config,
  source = 'builtin',
): Preset {
  return { engineId, modelId, hardwareClass, values, source }
}

describe('hardwareClass', () => {
  it('maps a GPU profile to the VRAM-plus-SM bucket', () => {
    expect(hardwareClass(HW_3090)).toBe('24g-sm86')
  })

  it('rounds the VRAM to the nearest GiB', () => {
    const hw: HardwareProfile = {
      ...HW_3090,
      gpu: { name: 'x', vramGiB: 24.5, sm: 89 },
    }
    expect(hardwareClass(hw)).toBe('25g-sm89')
  })

  it('reads a host with no detected GPU as no class', () => {
    expect(hardwareClass(HW_NO_GPU)).toBeUndefined()
  })
})

describe('resolveDefaults', () => {
  const specs = [spec('kvDtype', 'int8'), spec('maxContext', 32768), spec('hostKvMib')]

  it('floors on the spec defaults when no preset and no explicit value apply', () => {
    const result = resolveDefaults([], specs, 'ninfer', 'qwen3-27b', HW_NO_GPU)
    expect(result.config).toEqual({ kvDtype: 'int8', maxContext: 32768 })
    // hostKvMib has no default, so it is absent from the floor.
    expect(result.config.hostKvMib).toBeUndefined()
    expect(result.provenance.map(p => p.key)).toEqual(['kvDtype', 'maxContext'])
    expect(result.provenance.every(p => p.source === 'spec-default')).toBe(true)
  })

  it('applies the built-in (wildcard) preset over the spec floor', () => {
    const presets = [preset('ninfer', 'qwen3-27b', WILDCARD_HARDWARE_CLASS, { kvDtype: 'rk4v4' })]
    const result = resolveDefaults(presets, specs, 'ninfer', 'qwen3-27b', HW_NO_GPU)
    expect(result.config.kvDtype).toBe('rk4v4')
    expect(result.config.maxContext).toBe(32768)
    const kv = result.provenance.find(p => p.key === 'kvDtype')
    expect(kv?.source).toBe('builtin')
  })

  it('lets the exact-class preset beat the built-in preset', () => {
    const presets = [
      preset('ninfer', 'qwen3-27b', WILDCARD_HARDWARE_CLASS, { kvDtype: 'rk4v4' }),
      preset('ninfer', 'qwen3-27b', '24g-sm86', { kvDtype: 'int8', maxContext: 262144 }, 'measured'),
    ]
    const result = resolveDefaults(presets, specs, 'ninfer', 'qwen3-27b', HW_3090)
    expect(result.config.kvDtype).toBe('int8')
    expect(result.config.maxContext).toBe(262144)
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('measured')
  })

  it('ignores an exact-class preset when the host has no detected class', () => {
    const presets = [preset('ninfer', 'qwen3-27b', '24g-sm86', { kvDtype: 'int8' }, 'measured')]
    const result = resolveDefaults(presets, specs, 'ninfer', 'qwen3-27b', HW_NO_GPU)
    expect(result.config.kvDtype).toBe('int8') // the spec floor, not the preset
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('spec-default')
  })

  it('lets the explicit user value beat every preset', () => {
    const presets = [preset('ninfer', 'qwen3-27b', '24g-sm86', { kvDtype: 'int8' }, 'measured')]
    const result = resolveDefaults(presets, specs, 'ninfer', 'qwen3-27b', HW_3090, {
      kvDtype: 'nvfp4',
    })
    expect(result.config.kvDtype).toBe('nvfp4')
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('user')
  })

  it('only trusts a preset for the exact engine and model', () => {
    const presets = [preset('ninfer', 'qwen3-35b', '24g-sm86', { kvDtype: 'int8' }, 'measured')]
    const result = resolveDefaults(presets, specs, 'ninfer', 'qwen3-27b', HW_3090)
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('spec-default')
  })

  it('skips explicit values that are undefined', () => {
    const result = resolveDefaults([], specs, 'ninfer', 'qwen3-27b', HW_NO_GPU, {
      kvDtype: undefined,
      maxContext: 8192,
    })
    expect(result.config.kvDtype).toBe('int8')
    expect(result.config.maxContext).toBe(8192)
    expect(result.provenance.find(p => p.key === 'kvDtype')?.source).toBe('spec-default')
    expect(result.provenance.find(p => p.key === 'maxContext')?.source).toBe('user')
  })
})

describe('presetFromFetch', () => {
  it('tags the preset with the source URL and the fetch date', () => {
    const source: PresetSource = {
      engineId: 'ninfer',
      modelId: 'qwen3-27b',
      hardwareClass: '24g-sm86',
      url: 'https://example.com/ninfer',
      source: 'NInfer docs',
      extract: content => (content === 'hit' ? { kvDtype: 'int8' } : {}),
    }
    const preset = presetFromFetch(source, 'hit', '2026-10-13')
    expect(preset).toEqual({
      engineId: 'ninfer',
      modelId: 'qwen3-27b',
      hardwareClass: '24g-sm86',
      values: { kvDtype: 'int8' },
      source: 'https://example.com/ninfer',
      fetchedAt: '2026-10-13',
    })
  })

  it('reads a miss as an empty values config', () => {
    const source: PresetSource = {
      engineId: 'ninfer',
      modelId: 'qwen3-27b',
      hardwareClass: '24g-sm86',
      url: 'https://example.com/ninfer',
      source: 'NInfer docs',
      extract: () => ({ kvDtype: 'int8' }),
    }
    const preset = presetFromFetch(source, 'anything', '2026-10-13')
    expect(preset.values).toEqual({ kvDtype: 'int8' })
  })
})
