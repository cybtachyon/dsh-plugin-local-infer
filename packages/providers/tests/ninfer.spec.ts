import { describe, expect, it } from 'vitest'
import {
  CHAT_TEMPLATE_OPTIONS,
  DEVICE_PROFILE_OPTIONS,
  KV_DTYPE_OPTIONS,
  NINFER_PARAMETERS,
  SPEC_GATE_MESSAGE,
  SPEC_OPTIONS,
} from '../src/ninfer.ts'
import type { ParameterSpec } from '@dsh/dsh-plugin-local-infer/core'

// The same opener test the local-infer/behavior-first-description eslint rule
// runs, so a description that slips past the lint gate also fails the suite.
const IS_STYLE = /^\s*(is|it is|this is|are|was|were)\s/i

describe('NInfer parameter surface', () => {
  it('carries the 17-spec surface with unique keys', () => {
    const keys = NINFER_PARAMETERS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      'kvDtype',
      'maxContext',
      'kvCapacity',
      'hostKvMib',
      'hostStateSlots',
      'gdnStateFp16',
      'maxConcurrency',
      'spec',
      'draftTokens',
      'lmHeadDraft',
      'temperature',
      'minP',
      'prefillChunk',
      'vision',
      'structuredOutput',
      'deviceProfile',
      'chatTemplate',
    ])
  })

  it('renders every spec with a behavior-first description', () => {
    for (const spec of NINFER_PARAMETERS) {
      expect(spec.description.length).toBeGreaterThan(10)
      expect(IS_STYLE.test(spec.description), `${spec.key}: "${spec.description}"`).toBe(false)
    }
  })

  it('maps each form kind to the control the plan assigns', () => {
    const kindFor = (key: string) => NINFER_PARAMETERS.find((spec) => spec.key === key)?.form.kind
    expect(kindFor('kvDtype')).toBe('enum')
    expect(kindFor('spec')).toBe('enum')
    expect(kindFor('deviceProfile')).toBe('enum')
    expect(kindFor('maxContext')).toBe('number')
    expect(kindFor('draftTokens')).toBe('number')
    expect(kindFor('temperature')).toBe('number')
    expect(kindFor('gdnStateFp16')).toBe('boolean')
    expect(kindFor('vision')).toBe('boolean')
    expect(kindFor('lmHeadDraft')).toBe('boolean')
    // The plan's current direction: the chat template is a dropdown plus
    // free-text combo, not a bare path picker.
    expect(kindFor('chatTemplate')).toBe('combo')
  })

  it('spells the CLI flags the launcher script passes', () => {
    const argvFor = (key: string, value: unknown): string[] => {
      const spec = NINFER_PARAMETERS.find((candidate): candidate is ParameterSpec & { toArgv: (v: unknown) => string[] } => candidate.key === key)
      return spec.toArgv!(value)
    }
    expect(argvFor('kvDtype', 'rk4v4')).toEqual(['--kv-dtype', 'rk4v4'])
    expect(argvFor('maxContext', 262144)).toEqual(['--max-context', '262144'])
    expect(argvFor('spec', 'none')).toEqual([])
    expect(argvFor('spec', 'mtp')).toEqual(['--spec', 'mtp'])
    expect(argvFor('draftTokens', 7)).toEqual(['--draft-tokens', '7'])
    expect(argvFor('lmHeadDraft', true)).toEqual(['--lm-head-draft'])
    expect(argvFor('lmHeadDraft', false)).toEqual([])
    expect(argvFor('gdnStateFp16', true)).toEqual(['--gdn-state-fp16'])
    expect(argvFor('hostKvMib', 49152)).toEqual(['--host-kv-mib', '49152'])
    expect(argvFor('hostStateSlots', 16)).toEqual(['--host-state-slots', '16'])
    expect(argvFor('minP', 0.05)).toEqual(['--min-p', '0.05'])
    expect(argvFor('vision', false)).toEqual([])
    expect(argvFor('deviceProfile', 'auto')).toEqual([])
    expect(argvFor('deviceProfile', 'calibrate')).toEqual(['--device-profile', 'calibrate'])
    expect(argvFor('chatTemplate', '')).toEqual([])
    expect(argvFor('chatTemplate', '/tmp/qwen3_8.jinja')).toEqual(['--chat-template', '/tmp/qwen3_8.jinja'])
  })

  it('gates nvfp4 KV on SM 89 and lets the 30-series card keep rk4v4', () => {
    const spec = NINFER_PARAMETERS.find((candidate) => candidate.key === 'kvDtype')!
    const hw86 = { os: 'linux' as const, cpuThreads: 8, dockerAvailable: false, wsl2: false, gpu: { name: 'RTX 3090', vramGiB: 24, sm: 86 } }
    expect(spec.hardwareConstraint!('nvfp4', hw86)).toEqual({
      ok: false,
      severity: 'error',
      message: expect.stringContaining('SM 89'),
    })
    expect(spec.hardwareConstraint!('rk4v4', hw86)).toEqual({ ok: true })
    const hw89 = { ...hw86, gpu: { name: 'RTX 4090', vramGiB: 24, sm: 89 } }
    expect(spec.hardwareConstraint!('nvfp4', hw89)).toEqual({ ok: true })
  })

  it('keeps the speculation fields gated on a selected spec', () => {
    const gated = NINFER_PARAMETERS.filter((spec) => spec.key === 'draftTokens' || spec.key === 'lmHeadDraft')
    expect(gated).toHaveLength(2)
    for (const spec of gated) {
      // The gate message names the fix, not just the constraint, so the
      // disabled field tells the user the next click.
      expect(spec.requires!({ spec: 'none' })).toBe(SPEC_GATE_MESSAGE)
      expect(SPEC_GATE_MESSAGE).toBe('Pick a speculation backend first (mtp, dflash, or dflash2)')
      expect(spec.requires!({ spec: 'mtp' })).toBeNull()
      expect(spec.requires!({ spec: 'dflash2' })).toBeNull()
    }
  })

  it('ships the popular chat template as combo data with its source tag', () => {
    expect(CHAT_TEMPLATE_OPTIONS).toHaveLength(1)
    const option = CHAT_TEMPLATE_OPTIONS[0]!
    expect(option.value).toBe('froggeric/Qwen-Fixed-Chat-Templates')
    expect(option.source).toBe('popular')
    expect(option.label).toContain('Froggeric22')
  })

  it('lists the KV, spec, and device-profile options the docs name', () => {
    expect(KV_DTYPE_OPTIONS.map((option) => option.value)).toEqual([
      'bf16',
      'int8',
      'fp8',
      'rk8v4',
      'rk4v4',
      'k8v4',
      'nvfp4',
    ])
    expect(SPEC_OPTIONS.map((option) => option.value)).toEqual(['none', 'mtp', 'dflash', 'dflash2'])
    expect(DEVICE_PROFILE_OPTIONS.map((option) => option.value)).toEqual(['auto', 'calibrate', 'off'])
    // Every option carries a note, which the dropdown renders beside the label.
    for (const option of [...KV_DTYPE_OPTIONS, ...SPEC_OPTIONS, ...DEVICE_PROFILE_OPTIONS]) {
      expect(option.note?.length).toBeGreaterThan(5)
    }
  })
})
