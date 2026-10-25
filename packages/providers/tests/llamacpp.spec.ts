import { describe, expect, it } from 'vitest'
import {
  KV_CACHE_TYPE_OPTIONS,
  LLAMACPP_MODEL_ARTIFACTS,
  LLAMACPP_PARAMETERS,
  llamaCppModelKey,
} from '../src/engines/llamacpp.ts'
import type { ParameterSpec } from 'dsh-plugin-local-infer/core'

// The same opener test the local-infer/behavior-first-description eslint rule
// runs, so a description that slips past the lint gate also fails the suite.
const IS_STYLE = /^\s*(is|it is|this is|are|was|were)\s/i

describe('llama.cpp parameter surface', () => {
  it('carries the 10-spec surface with unique keys', () => {
    const keys = LLAMACPP_PARAMETERS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'ctxSize',
      'gpuLayers',
      'kvCacheType',
      'threads',
      'batchSize',
      'parallel',
      'temp',
      'topP',
      'flashAttn',
      'jinja',
    ])
  })

  it('renders every spec with a behavior-first description', () => {
    for (const spec of LLAMACPP_PARAMETERS) {
      expect(spec.description.length).toBeGreaterThan(10)
      expect(IS_STYLE.test(spec.description), `${spec.key}: "${spec.description}"`).toBe(false)
    }
  })

  it('maps each form kind to the control the plan assigns', () => {
    const kindFor = (key: string) =>
      LLAMACPP_PARAMETERS.find((spec) => spec.key === key)?.form.kind
    expect(kindFor('kvCacheType')).toBe('enum')
    expect(kindFor('ctxSize')).toBe('number')
    expect(kindFor('gpuLayers')).toBe('number')
    expect(kindFor('threads')).toBe('number')
    expect(kindFor('batchSize')).toBe('number')
    expect(kindFor('parallel')).toBe('number')
    expect(kindFor('temp')).toBe('number')
    expect(kindFor('topP')).toBe('number')
    expect(kindFor('flashAttn')).toBe('boolean')
    expect(kindFor('jinja')).toBe('boolean')
  })

  it('spells the llama-server flags the launcher passes', () => {
    const argvFor = (key: string, value: unknown): string[] => {
      const spec = LLAMACPP_PARAMETERS.find(
        (candidate): candidate is ParameterSpec & { toArgv: (v: unknown) => string[] } =>
          candidate.key === key,
      )
      return spec.toArgv!(value)
    }
    expect(argvFor('ctxSize', 8192)).toEqual(['--ctx-size', '8192'])
    expect(argvFor('gpuLayers', 99)).toEqual(['--n-gpu-layers', '99'])
    expect(argvFor('kvCacheType', 'q8_0')).toEqual([
      '--cache-type-k',
      'q8_0',
      '--cache-type-v',
      'q8_0',
    ])
    expect(argvFor('threads', 8)).toEqual(['--threads', '8'])
    expect(argvFor('batchSize', 256)).toEqual(['--batch-size', '256'])
    expect(argvFor('parallel', 2)).toEqual(['--parallel', '2'])
    expect(argvFor('temp', 0.9)).toEqual(['--temp', '0.9'])
    expect(argvFor('topP', 0.95)).toEqual(['--top-p', '0.95'])
    expect(argvFor('flashAttn', true)).toEqual(['--flash-attn'])
    expect(argvFor('flashAttn', false)).toEqual([])
    expect(argvFor('jinja', true)).toEqual(['--jinja'])
    expect(argvFor('jinja', false)).toEqual([])
  })

  it('ships the default GGUF artifacts with the keys the config names', () => {
    expect(Object.keys(LLAMACPP_MODEL_ARTIFACTS)).toEqual(['qwen3-27b', 'qwen36-35b'])
    const artifact = LLAMACPP_MODEL_ARTIFACTS['qwen3-27b']!
    expect(artifact.file).toBe('Qwen3.8-27B-Q4_K_M.gguf')
    expect(artifact.repo).toBe('ggml-org/Qwen3.8-27B-GGUF')
    expect(artifact.modelId).toBe('Qwen3.8-27B')
    const thirtyFive = LLAMACPP_MODEL_ARTIFACTS['qwen36-35b']!
    expect(thirtyFive.file).toBe('Qwen3.6-35B-A3B-Q4_K_M.gguf')
    expect(thirtyFive.repo).toBe('bartowski/Qwen_Qwen3.6-35B-A3B-GGUF')
    expect(thirtyFive.modelId).toBe('Qwen3.6-35B-A3B')
  })

  it('resolves the model key from the config, defaulting to the 27B entry', () => {
    expect(llamaCppModelKey({ model: 'qwen3-27b' })).toBe('qwen3-27b')
    // No model named: the 27B default, the renderLaunch rule.
    expect(llamaCppModelKey({})).toBe('qwen3-27b')
  })

  it('lists the KV cache options the llama-server CLI names', () => {
    expect(KV_CACHE_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'f16',
      'q8_0',
      'q4_0',
      'q4_1',
      'q5_0',
      'q5_1',
    ])
    // Every option carries a note, which the dropdown renders beside the label.
    for (const option of KV_CACHE_TYPE_OPTIONS) {
      expect(option.note?.length).toBeGreaterThan(5)
    }
  })
})
