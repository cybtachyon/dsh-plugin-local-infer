import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODELS,
  defaultModelFor,
  defaultModelsForEngine,
} from '../src/model-defaults.ts'

describe('DEFAULT_MODELS', () => {
  it('carries the twelve default models: three NInfer, two per other dense-Qwen engine, three Infernix, two Strata', () => {
    expect(DEFAULT_MODELS).toHaveLength(12)
    expect(defaultModelsForEngine('ninfer')).toHaveLength(3)
    expect(defaultModelsForEngine('hyperqwen')).toHaveLength(2)
    expect(defaultModelsForEngine('llamacpp')).toHaveLength(2)
    expect(defaultModelsForEngine('infernix')).toHaveLength(3)
    expect(defaultModelsForEngine('strata')).toHaveLength(2)
  })

  it('carries the two Strata models the README links: Gyro and DeepSeek V4.1-Flash', () => {
    const strata = defaultModelsForEngine('strata')
    expect(strata.map((entry) => entry.modelId)).toEqual(['gyro-s', 'ist-das-2.00bpw'])
    // The engine downloads the model itself, so the entries name the repo only.
    expect(strata.every((entry) => entry.file === undefined)).toBe(true)
  })

  it('names the exact default repos the plugin ships', () => {
    const urls = DEFAULT_MODELS.map((entry) => entry.url)
    expect(urls).toEqual([
      'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
      'https://huggingface.co/kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
      'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      'https://huggingface.co/born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
      'https://huggingface.co/QuantTrio/Qwen3.6-35B-A3B-AWQ',
      'https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF',
      'https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF',
      'https://huggingface.co/Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3',
      'https://huggingface.co/Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix',
      'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
      'https://huggingface.co/agentionai/Qwen3.8-Flash-Next-Gyro-GGUF',
      'https://huggingface.co/ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF',
    ])
  })

  it('reuses the 27B registry key and adds a distinct 35B-A3B key per engine', () => {
    expect(defaultModelFor('ninfer', 'qwen3-27b')?.label).toBe('Ninfer Qwen3.8-27B')
    expect(defaultModelFor('ninfer', 'qwen3-27b-swift15')?.label).toBe('Ninfer Qwen3.8-27B (Swift 1.5)')
    expect(defaultModelFor('ninfer', 'qwen36-35b')?.label).toBe('Ninfer Qwen3.6-35B')
    expect(defaultModelFor('llamacpp', 'qwen36-35b')?.label).toBe('llama.cpp Qwen3.6-35B')
    expect(defaultModelFor('infernix', 'qwen3-27b')?.label).toBe('Infernix Qwen3.8-27B')
    expect(defaultModelFor('infernix', 'qwen38-flash-next')?.label).toBe(
      'Infernix Qwen3.8-Flash-Next (Dense8)',
    )
    // The Flash-Next entry names no single file: the download pulls the whole
    // repo, which carries the shards and the n-gram volume.
    expect(defaultModelFor('infernix', 'qwen38-flash-next')?.file).toBeUndefined()
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
