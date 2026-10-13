import { describe, expect, it } from 'vitest'
import { CTX_OPTIONS, HYPERQWEN_PARAMETERS, KV_OPTIONS } from '../src/hyperqwen.ts'
import type { ParameterSpec } from '@dsh/dsh-plugin-local-infer-core'

const IS_STYLE = /^\s*(is|it is|this is|are|was|were)\s/i

describe('Hyper-Qwen parameter surface', () => {
  it('carries the env-key surface with unique keys', () => {
    const keys = HYPERQWEN_PARAMETERS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'spec',
      'draftTokens',
      'ctx',
      'kv',
      'gpuUtil',
      'maxLen',
      'maxSeqs',
      'vision',
      'pinMemory',
      'prefixCache',
      'apiKey',
      'port',
    ])
  })

  it('renders every spec with a behavior-first description', () => {
    for (const spec of HYPERQWEN_PARAMETERS) {
      expect(spec.description.length).toBeGreaterThan(10)
      expect(IS_STYLE.test(spec.description), `${spec.key}: "${spec.description}"`).toBe(false)
    }
  })

  it('spells the .env keys the compose file passes into the container', () => {
    const envFor = (key: string, value: unknown): [string, string] => {
      const spec = HYPERQWEN_PARAMETERS.find(
        (candidate): candidate is ParameterSpec & { toEnv: (v: unknown) => [string, string] } =>
          candidate.key === key,
      )
      return spec.toEnv!(value)
    }
    expect(envFor('spec', 'dflash2')).toEqual(['SPEC', 'dflash2'])
    expect(envFor('draftTokens', 15)).toEqual(['DFLASH_TOKENS', '15'])
    expect(envFor('ctx', 'huge')).toEqual(['CTX', 'huge'])
    expect(envFor('kv', 'kvarn')).toEqual(['KV', 'kvarn'])
    expect(envFor('gpuUtil', 0.93)).toEqual(['GPU_UTIL', '0.93'])
    expect(envFor('maxLen', 65536)).toEqual(['MAX_LEN', '65536'])
    expect(envFor('maxSeqs', 8)).toEqual(['MAX_SEQS', '8'])
    expect(envFor('vision', true)).toEqual(['VISION', '1'])
    expect(envFor('vision', false)).toEqual(['VISION', '0'])
    expect(envFor('pinMemory', true)).toEqual(['VLLM_WSL2_ENABLE_PIN_MEMORY', '1'])
    expect(envFor('prefixCache', true)).toEqual(['PREFIX_CACHE', '1'])
    expect(envFor('apiKey', 'secret')).toEqual(['VLLM_API_KEY', 'secret'])
    expect(envFor('port', 18020)).toEqual(['PORT', '18020'])
  })

  it('keeps draftTokens gated on a dflash spec', () => {
    const spec = HYPERQWEN_PARAMETERS.find((candidate) => candidate.key === 'draftTokens')!
    expect(spec.requires!({ spec: 'mtp' })).toBe('SPEC must be dflash or dflash2; mtp uses its fixed draft count')
    expect(spec.requires!({ spec: 'dflash2' })).toBeNull()
    expect(spec.requires!({ spec: 'dflash' })).toBeNull()
  })

  it('lists the context, KV, and spec tiers the start scripts document', () => {
    expect(CTX_OPTIONS.map((option) => option.value)).toEqual(['fast', 'long', 'huge'])
    expect(KV_OPTIONS.map((option) => option.value)).toEqual(['bf16', 'int8', 'fp8', 'kvarn', 'int4pth'])
    for (const option of [...CTX_OPTIONS, ...KV_OPTIONS]) {
      expect(option.note?.length).toBeGreaterThan(5)
    }
  })
})
