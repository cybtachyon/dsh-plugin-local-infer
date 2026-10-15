import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, PRESET_SOURCES, extractJsonBlock } from '../src/index.ts'
import type { Preset } from 'dsh-plugin-local-infer/core'

describe('BUILTIN_PRESETS', () => {
  it('ships the NInfer measured presets for the 24 GiB sm86 card', () => {
    const ninfer = BUILTIN_PRESETS.filter(preset => preset.engineId === 'ninfer')
    expect(ninfer).toHaveLength(2)
    const twentySeven = ninfer.find(preset => preset.modelId === 'qwen3-27b')
    expect(twentySeven?.hardwareClass).toBe('24g-sm86')
    expect(twentySeven?.values).toMatchObject({
      kvDtype: 'int8',
      maxContext: 262144,
      spec: 'mtp',
    })
    // nvfp4 needs SM 89, so the sm86 preset uses the sm86-safe int8 tier.
    expect(twentySeven?.values.kvDtype).not.toBe('nvfp4')
  })

  it('ships the Hyper-Qwen profile presets for the 24 GiB sm86 card', () => {
    const hyper = BUILTIN_PRESETS.filter(preset => preset.engineId === 'hyperqwen')
    expect(hyper).toHaveLength(3)
    const tiers = hyper.map(preset => preset.values.ctx)
    expect(tiers).toEqual(['fast', 'long', 'huge'])
    // The huge tier is the KVarN 4/2-bit KV cache.
    const huge = hyper.find(preset => preset.values.ctx === 'huge')
    expect(huge?.values.kv).toBe('kvarn')
  })

  it('keys every preset by its exact triple and a source tag', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.engineId).not.toBe('')
      expect(preset.modelId).not.toBe('')
      expect(preset.hardwareClass).toBe('24g-sm86')
      expect(preset.source).not.toBe('')
    }
  })
})

describe('PRESET_SOURCES', () => {
  it('names a mod-search source with a URL and a pure extractor', () => {
    expect(PRESET_SOURCES.length).toBeGreaterThan(0)
    const source = PRESET_SOURCES[0]
    expect(source?.url).toMatch(/^https:\/\//)
    expect(source?.engineId).toBe('ninfer')
    expect(typeof source?.extract).toBe('function')
  })
})

describe('extractJsonBlock', () => {
  it('reads the first fenced json block as the values', () => {
    const content = 'before\n```json\n{ "kvDtype": "int8", "maxContext": 8192 }\n```\nafter'
    expect(extractJsonBlock(content)).toEqual({ kvDtype: 'int8', maxContext: 8192 })
  })

  it('reads a page with no json block as an empty config', () => {
    expect(extractJsonBlock('no block here')).toEqual({})
  })

  it('reads a broken json block as an empty config', () => {
    expect(extractJsonBlock('```json\n{ not json }\n```')).toEqual({})
  })

  it('reads a json array block as an empty config', () => {
    expect(extractJsonBlock('```json\n[1, 2, 3]\n```')).toEqual({})
  })
})

/** The preset list is the data the resolver consumes; pin the shape. */
describe('preset data shape', () => {
  it('keeps every preset value a plain config record', () => {
    for (const preset of BUILTIN_PRESETS as Preset[]) {
      expect(typeof preset.values).toBe('object')
      expect(Array.isArray(preset.values)).toBe(false)
    }
  })
})
