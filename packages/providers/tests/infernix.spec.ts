import { describe, expect, it } from 'vitest'
import {
  DFLASH2_GATE_MESSAGE,
  INFERNIX_KV_DTYPE_OPTIONS,
  INFERNIX_MODEL_ARTIFACTS,
  INFERNIX_NGRAM_RESIDENCY_OPTIONS,
  INFERNIX_PARAMETERS,
  INFERNIX_REASONING_LOOP_OPTIONS,
  INFERNIX_SPEC_OPTIONS,
  SPEC_GATE_MESSAGE,
  infernixArtifactFor,
  infernixModelKey,
} from '../src/infernix.ts'
import { NINFER_PARAMETERS } from '../src/ninfer.ts'
import type { ParameterSpec } from 'dsh-plugin-local-infer/core'

// The same opener test the local-infer/behavior-first-description eslint rule
// runs, so a description that slips past the lint gate also fails the suite.
const IS_STYLE = /^\s*(is|it is|this is|are|was|were)\s/i

describe('Infernix parameter surface', () => {
  it('carries the 36-spec surface with unique keys', () => {
    const keys = INFERNIX_PARAMETERS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'port',
      'kvDtype',
      'maxContext',
      'kvCapacity',
      'hostContextMib',
      'mediaLiveMib',
      'ramHeadroomMib',
      'vramHeadroomMib',
      'expertRamMib',
      'expertPinMib',
      'ngramResidency',
      'maxConcurrency',
      'maxPendingRequests',
      'spec',
      'draftTokens',
      'lmHeadDraft',
      'draftModel',
      'ngramDraftTokens',
      'ngramMinMatch',
      'ngramVolume',
      'expertState',
      'prefixCacheFile',
      'prefillChunk',
      'vision',
      'noCudaGraph',
      'reproducible',
      'lossless',
      'ropeYarnFactor',
      'chatTemplate',
      'temperature',
      'minP',
      'defaultMaxTokens',
      'defaultThinkingBudget',
      'preserveThinking',
      'tolerantToolCalls',
      'reasoningLoop',
    ])
  })

  it('renders every spec with a behavior-first description', () => {
    for (const spec of INFERNIX_PARAMETERS) {
      expect(spec.description.length).toBeGreaterThan(10)
      expect(IS_STYLE.test(spec.description), `${spec.key}: "${spec.description}"`).toBe(false)
    }
  })

  it('maps each form kind to the control the plan assigns', () => {
    const kindFor = (key: string) =>
      INFERNIX_PARAMETERS.find((spec) => spec.key === key)?.form.kind
    expect(kindFor('port')).toBe('number')
    expect(kindFor('kvDtype')).toBe('enum')
    expect(kindFor('spec')).toBe('enum')
    expect(kindFor('ngramResidency')).toBe('enum')
    expect(kindFor('reasoningLoop')).toBe('enum')
    expect(kindFor('maxContext')).toBe('number')
    expect(kindFor('hostContextMib')).toBe('number')
    expect(kindFor('draftTokens')).toBe('number')
    expect(kindFor('vision')).toBe('boolean')
    expect(kindFor('noCudaGraph')).toBe('boolean')
    expect(kindFor('reproducible')).toBe('boolean')
    expect(kindFor('lossless')).toBe('boolean')
    expect(kindFor('lmHeadDraft')).toBe('boolean')
    expect(kindFor('draftModel')).toBe('path')
    expect(kindFor('ngramVolume')).toBe('path')
    expect(kindFor('expertState')).toBe('path')
    expect(kindFor('prefixCacheFile')).toBe('path')
    // The chat template is a dropdown plus free-text combo, the NInfer shape.
    expect(kindFor('chatTemplate')).toBe('combo')
  })

  it('spells the CLI flags the infernix-serve CLI takes', () => {
    const argvFor = (key: string, value: unknown): string[] => {
      const spec = INFERNIX_PARAMETERS.find(
        (candidate): candidate is ParameterSpec & { toArgv: (v: unknown) => string[] } =>
          candidate.key === key && candidate.toArgv !== undefined,
      )
      return spec!.toArgv!(value)
    }
    expect(argvFor('kvDtype', 'vq2')).toEqual(['--kv-dtype', 'vq2'])
    expect(argvFor('maxContext', 262144)).toEqual(['--max-context', '262144'])
    expect(argvFor('hostContextMib', 8192)).toEqual(['--host-context-mib', '8192'])
    expect(argvFor('spec', 'none')).toEqual([])
    expect(argvFor('spec', 'dflash2')).toEqual(['--spec', 'dflash2'])
    expect(argvFor('draftTokens', 7)).toEqual(['--draft-tokens', '7'])
    expect(argvFor('lmHeadDraft', true)).toEqual(['--lm-head-draft'])
    expect(argvFor('lmHeadDraft', false)).toEqual([])
    expect(argvFor('ngramVolume', '/models/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram')).toEqual([
      '--ngram-volume',
      '/models/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram',
    ])
    expect(argvFor('ngramVolume', '')).toEqual([])
    expect(argvFor('draftModel', '/models/Qwen3.8-Flash-Next-DFlash2-Infernix.infernix')).toEqual([
      '--draft-model',
      '/models/Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
    ])
    expect(argvFor('ngramResidency', 'auto')).toEqual([])
    expect(argvFor('ngramResidency', 'ram')).toEqual(['--ngram-residency', 'ram'])
    expect(argvFor('ngramDraftTokens', 0)).toEqual([])
    expect(argvFor('ngramDraftTokens', 63)).toEqual(['--ngram-draft-tokens', '63'])
    expect(argvFor('ngramMinMatch', 12)).toEqual(['--ngram-min-match', '12'])
    expect(argvFor('expertRamMib', 49152)).toEqual(['--expert-ram-mib', '49152'])
    expect(argvFor('expertPinMib', 8192)).toEqual(['--expert-pin-mib', '8192'])
    expect(argvFor('ramHeadroomMib', 2048)).toEqual(['--ram-headroom-mib', '2048'])
    expect(argvFor('vramHeadroomMib', 1024)).toEqual(['--vram-headroom-mib', '1024'])
    expect(argvFor('noCudaGraph', true)).toEqual(['--no-cuda-graph'])
    expect(argvFor('reproducible', true)).toEqual(['--reproducible'])
    expect(argvFor('lossless', true)).toEqual(['--lossless'])
    expect(argvFor('ropeYarnFactor', 1)).toEqual([])
    expect(argvFor('ropeYarnFactor', 2)).toEqual(['--rope-yarn-factor', '2'])
    expect(argvFor('tolerantToolCalls', true)).toEqual(['--tolerant-tool-calls'])
    expect(argvFor('reasoningLoop', 'off')).toEqual([])
    expect(argvFor('reasoningLoop', 'stop')).toEqual(['--reasoning-loop', 'stop'])
    expect(argvFor('maxPendingRequests', 32)).toEqual(['--max-pending-requests', '32'])
    expect(argvFor('kvCapacity', 262144)).toEqual(['--kv-capacity', '262144'])
    expect(argvFor('prefillChunk', 4096)).toEqual(['--prefill-chunk', '4096'])
    expect(argvFor('vision', false)).toEqual([])
    expect(argvFor('chatTemplate', '')).toEqual([])
    expect(argvFor('chatTemplate', '/tmp/qwen3_8.jinja')).toEqual([
      '--chat-template',
      '/tmp/qwen3_8.jinja',
    ])
    expect(argvFor('preserveThinking', true)).toEqual(['--preserve-thinking'])
    expect(argvFor('defaultMaxTokens', 32768)).toEqual(['--default-max-tokens', '32768'])
    expect(argvFor('mediaLiveMib', 2048)).toEqual(['--media-live-mib', '2048'])
    expect(argvFor('defaultThinkingBudget', 16384)).toEqual([
      '--default-thinking-budget',
      '16384',
    ])
    expect(argvFor('prefixCacheFile', '/models/prefix-cache.bin')).toEqual([
      '--prefix-cache-file',
      '/models/prefix-cache.bin',
    ])
    expect(argvFor('expertState', 'off')).toEqual(['--expert-state', 'off'])
  })

  it('gates nvfp4 KV on SM 89 and lets the 30-series card keep vq2', () => {
    const spec = INFERNIX_PARAMETERS.find((candidate) => candidate.key === 'kvDtype')!
    const hw86 = {
      os: 'linux' as const,
      cpuThreads: 8,
      dockerAvailable: false,
      wsl2: false,
      gpu: { name: 'RTX 3090', vramGiB: 24, sm: 86 },
    }
    expect(spec.hardwareConstraint!('nvfp4', hw86)).toEqual({
      ok: false,
      severity: 'error',
      message: expect.stringContaining('SM 89'),
    })
    expect(spec.hardwareConstraint!('vq2', hw86)).toEqual({ ok: true })
    const hw120 = { ...hw86, gpu: { name: 'RTX 5090', vramGiB: 32, sm: 120 } }
    expect(spec.hardwareConstraint!('nvfp4', hw120)).toEqual({ ok: true })
  })

  it('keeps the speculation fields gated on a selected spec', () => {
    const gated = INFERNIX_PARAMETERS.filter(
      (spec) => spec.key === 'draftTokens' || spec.key === 'lmHeadDraft',
    )
    expect(gated).toHaveLength(2)
    for (const spec of gated) {
      expect(spec.requires!({ spec: 'none' })).toBe(SPEC_GATE_MESSAGE)
      expect(SPEC_GATE_MESSAGE).toBe('Pick a speculation backend first (mtp, dflash, or dflash2)')
      expect(spec.requires!({ spec: 'mtp' })).toBeNull()
      expect(spec.requires!({ spec: 'dflash2' })).toBeNull()
    }
  })

  it('gates the DFlash2 drafter on the dflash2 backend only', () => {
    const spec = INFERNIX_PARAMETERS.find((candidate) => candidate.key === 'draftModel')!
    expect(spec.requires!({ spec: 'dflash2' })).toBeNull()
    expect(spec.requires!({ spec: 'mtp' })).toBe(DFLASH2_GATE_MESSAGE)
    expect(spec.requires!({ spec: 'none' })).toBe(DFLASH2_GATE_MESSAGE)
  })

  it('gates the n-gram minimum match on enabled n-gram drafting', () => {
    const spec = INFERNIX_PARAMETERS.find((candidate) => candidate.key === 'ngramMinMatch')!
    expect(spec.requires!({ ngramDraftTokens: 63 })).toBeNull()
    const reason = spec.requires!({ ngramDraftTokens: 0 })
    expect(reason).not.toBeNull()
    expect(spec.requires!({})).not.toBeNull()
  })

  it('lists the Infernix KV, spec, residency, and reasoning-loop options', () => {
    expect(INFERNIX_KV_DTYPE_OPTIONS.map((option) => option.value)).toEqual([
      'bf16',
      'int8',
      'fp8',
      'nvfp4',
      'k8v4',
      'vq2',
      'k4v2',
    ])
    expect(INFERNIX_SPEC_OPTIONS.map((option) => option.value)).toEqual([
      'none',
      'mtp',
      'dflash',
      'dflash2',
    ])
    expect(INFERNIX_NGRAM_RESIDENCY_OPTIONS.map((option) => option.value)).toEqual([
      'auto',
      'ram',
      'volume',
    ])
    expect(INFERNIX_REASONING_LOOP_OPTIONS.map((option) => option.value)).toEqual([
      'off',
      'stop',
      'conclude',
    ])
    // Every option carries a note, which the dropdown renders beside the label.
    for (const option of [
      ...INFERNIX_KV_DTYPE_OPTIONS,
      ...INFERNIX_SPEC_OPTIONS,
      ...INFERNIX_NGRAM_RESIDENCY_OPTIONS,
      ...INFERNIX_REASONING_LOOP_OPTIONS,
    ]) {
      expect(option.note?.length).toBeGreaterThan(5)
    }
  })

  it('ships the artifact map with the HF repos the README names', () => {
    expect(INFERNIX_MODEL_ARTIFACTS['qwen3-27b']).toEqual({
      file: 'qwen3_8_27b_nvfp4-nvidia.ninfer',
      repo: 'Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3',
      modelId: 'Qwen3.8-27B',
    })
    const flashNext = INFERNIX_MODEL_ARTIFACTS['qwen38-flash-next']!
    expect(flashNext.repo).toBe('Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix')
    expect(flashNext.files).toHaveLength(3)
    expect(flashNext.file).toBe(flashNext.files![0])
    expect(INFERNIX_MODEL_ARTIFACTS['qwen36-35b']!.repo).toBe(
      'neroued/Qwen3.6-35B-A3B-NInfer',
    )
  })

  it('resolves the model key and artifact with the 27B fallback', () => {
    expect(infernixModelKey({})).toBe('qwen3-27b')
    expect(infernixModelKey({ model: 'qwen38-flash-next' })).toBe('qwen38-flash-next')
    // A directory-scanned artifact name passes through, and the artifact
    // lookup falls back to the 27B entry for its model id.
    expect(infernixModelKey({ model: 'some_local.ninfer' })).toBe('some_local.ninfer')
    expect(infernixArtifactFor('some_local.ninfer').modelId).toBe('Qwen3.8-27B')
    expect(infernixArtifactFor('qwen38-flash-next').modelId).toBe('Qwen3.8-Flash-Next')
    expect(infernixArtifactFor('unknown-model').modelId).toBe('Qwen3.8-27B')
  })

  it('keeps the Infernix-only fields off the NInfer surface', () => {
    // The fields that differ from the other provider types live only on the
    // Infernix surface, so the form shows them only while Infernix is
    // selected and the other engines never spell them.
    const infernixKeys = new Set(INFERNIX_PARAMETERS.map((spec) => spec.key))
    const ninferKeys = new Set(NINFER_PARAMETERS.map((spec) => spec.key))
    const infernixOnly = ['ngramVolume', 'draftModel', 'ngramResidency', 'ngramDraftTokens', 'ngramMinMatch', 'expertRamMib', 'expertPinMib', 'expertState', 'prefixCacheFile', 'ramHeadroomMib', 'vramHeadroomMib', 'noCudaGraph', 'reproducible', 'lossless', 'ropeYarnFactor', 'tolerantToolCalls', 'reasoningLoop', 'maxPendingRequests', 'hostContextMib']
    for (const key of infernixOnly) {
      expect(infernixKeys.has(key), `${key} on the Infernix surface`).toBe(true)
      expect(ninferKeys.has(key), `${key} off the NInfer surface`).toBe(false)
    }
  })
})
