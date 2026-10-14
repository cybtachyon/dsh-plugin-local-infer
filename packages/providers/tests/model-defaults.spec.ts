import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODELS,
  defaultModelFor,
  defaultModelsForEngine,
} from '../src/model-defaults.ts'

describe('DEFAULT_MODELS', () => {
  it('carries the six default models, two per dense-Qwen engine', () => {
    expect(DEFAULT_MODELS).toHaveLength(6)
    expect(defaultModelsForEngine('ninfer')).toHaveLength(2)
    expect(defaultModelsForEngine('hyperqwen')).toHaveLength(2)
    expect(defaultModelsForEngine('llamacpp')).toHaveLength(2)
  })

  it('carries no Strata entry: the engine does not focus on the dense Qwen models', () => {
    expect(defaultModelsForEngine('strata')).toEqual([])
  })

  it('names the exact default repos the plugin ships', () => {
    const urls = DEFAULT_MODELS.map((entry) => entry.url)
    expect(urls).toEqual([
      'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      'https://huggingface.co/born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
      'https://huggingface.co/QuantTrio/Qwen3.6-35B-A3B-AWQ',
      'https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF',
      'https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF',
    ])
  })

  it('reuses the 27B registry key and adds a distinct 35B-A3B key per engine', () => {
    expect(defaultModelFor('ninfer', 'qwen3-27b')?.label).toBe('Ninfer Qwen3.8-27B')
    expect(defaultModelFor('ninfer', 'qwen36-35b')?.label).toBe('Ninfer Qwen3.6-35B')
    expect(defaultModelFor('llamacpp', 'qwen36-35b')?.label).toBe('llama.cpp Qwen3.6-35B')
  })
})

describe('defaultModelFor', () => {
  it('resolves the entry for a named (engine, model) pair', () => {
    const entry = defaultModelFor('hyperqwen', 'qwen36-35b')
    expect(entry?.url).toBe('https://huggingface.co/QuantTrio/Qwen3.6-35B-A3B-AWQ')
  })

  it('reads a pair no entry names as undefined', () => {
    expect(defaultModelFor('strata', 'qwen3-27b')).toBeUndefined()
    expect(defaultModelFor('ninfer', 'qwen3-35b')).toBeUndefined()
  })
})
