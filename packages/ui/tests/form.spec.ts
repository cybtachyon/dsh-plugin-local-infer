import { describe, expect, it } from 'vitest'
import {
  GENERAL_GROUP,
  controlFor,
  renderForm,
  resolveValue,
} from '../src/form.ts'
import { NINFER_PARAMETERS } from 'dsh-plugin-local-infer/providers'
import type {
  ComboOption,
  Config,
  EnumOption,
  ParameterSpec,
} from 'dsh-plugin-local-infer/core'

const ENUM_OPTIONS: EnumOption[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
]

const COMBO_OPTIONS: ComboOption[] = [
  { value: 'froggeric/Qwen-Fixed-Chat-Templates', label: 'Froggeric22', source: 'popular' },
]

function spec(partial: Partial<ParameterSpec> & Pick<ParameterSpec, 'key' | 'label' | 'description' | 'form'>): ParameterSpec {
  return partial
}

describe('controlFor', () => {
  it('maps each form kind to the control the plan assigns', () => {
    expect(controlFor({ kind: 'boolean' }).kind).toBe('checkbox')
    expect(controlFor({ kind: 'enum', options: ENUM_OPTIONS }).kind).toBe('dropdown')
    expect(controlFor({ kind: 'number', min: 0, max: 1, step: 0.1, unit: 'x' })).toEqual({
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.1,
      unit: 'x',
    })
    expect(controlFor({ kind: 'number' })).toEqual({ kind: 'slider' })
    expect(controlFor({ kind: 'text', placeholder: 'type here' }).placeholder).toBe('type here')
    expect(controlFor({ kind: 'path' })).toEqual({ kind: 'picker' })
    expect(controlFor({ kind: 'combo', options: COMBO_OPTIONS })).toEqual({
      kind: 'combo',
      options: COMBO_OPTIONS,
    })
  })

  it('leaves optional slider bounds off the control when the spec omits them', () => {
    const control = controlFor({ kind: 'number', min: 1 })
    expect('max' in control).toBe(false)
    expect('step' in control).toBe(false)
  })

  it('renders a number entry without the range strip when slider is false', () => {
    const control = controlFor({ kind: 'number', min: 1, max: 65535, slider: false })
    expect(control).toEqual({ kind: 'slider', min: 1, max: 65535, slider: false })
  })

  it('leaves the slider hint off the control when the spec omits it', () => {
    const control = controlFor({ kind: 'number', min: 0 })
    expect('slider' in control).toBe(false)
  })

  it('prices the sliderMax from the hardware profile when the form declares it', () => {
    const hw = { hostRamGiB: 32, dockerAvailable: false, wsl2: false, os: 'linux' as const, cpuThreads: 8 }
    const form = {
      kind: 'number' as const,
      min: 0,
      step: 1024,
      unit: 'MiB',
      sliderMax: (profile: { hostRamGiB?: number }) =>
        Math.max(0, Math.floor((profile.hostRamGiB ?? 0) * 0.5 * 1024)),
    }
    const control = controlFor(form, hw)
    expect(control.sliderMax).toBe(16384)
    // The static max stays off the number entry, so a typed value is uncapped.
    expect('max' in control).toBe(false)
  })

  it('leaves sliderMax off the control when no hardware profile is passed', () => {
    const form = {
      kind: 'number' as const,
      sliderMax: () => 128,
    }
    const control = controlFor(form)
    expect('sliderMax' in control).toBe(false)
  })
})

describe('resolveValue', () => {
  it('prefers the config value over the spec default', () => {
    const s = spec({ key: 'x', label: 'X', description: 'Tunes X.', form: { kind: 'number' }, defaultValue: 5 })
    expect(resolveValue(s, { x: 9 })).toBe(9)
    expect(resolveValue(s, {})).toBe(5)
  })

  it('falls through to the default when the config carries an explicit undefined', () => {
    const s = spec({ key: 'x', label: 'X', description: 'Tunes X.', form: { kind: 'number' }, defaultValue: 5 })
    expect(resolveValue(s, { x: undefined })).toBe(5)
  })
})

describe('renderForm', () => {
  it('groups fields by group and renders ungrouped specs under General', () => {
    const specs = [
      spec({ key: 'a', label: 'A', description: 'Tunes A.', form: { kind: 'boolean' }, group: 'Memory' }),
      spec({ key: 'b', label: 'B', description: 'Tunes B.', form: { kind: 'boolean' } }),
      spec({ key: 'c', label: 'C', description: 'Tunes C.', form: { kind: 'boolean' }, group: 'Memory' }),
      spec({ key: 'd', label: 'D', description: 'Tunes D.', form: { kind: 'boolean' }, group: 'Sampling' }),
    ]
    const model = renderForm(specs, {})
    expect(model.sections.map((section) => section.group)).toEqual(['Memory', GENERAL_GROUP, 'Sampling'])
    expect(model.sections[0]!.fields.map((field) => field.key)).toEqual(['a', 'c'])
    expect(model.sections[1]!.fields.map((field) => field.key)).toEqual(['b'])
    expect(model.sections[2]!.fields.map((field) => field.key)).toEqual(['d'])
  })

  it('carries the description under every field, which the plan requires', () => {
    const model = renderForm(
      [spec({ key: 'a', label: 'A', description: 'Tunes A.', form: { kind: 'boolean' } })],
      {},
    )
    expect(model.sections[0]!.fields[0]!.description).toBe('Tunes A.')
  })

  it('disables a field whose requires names a missing dependency, and re-enables it once present', () => {
    const gated: ParameterSpec = {
      key: 'draftTokens',
      label: 'Draft tokens',
      description: 'Tunes drafting.',
      form: { kind: 'number', min: 1, max: 15 },
      requires: (config: Config) => (config.spec ? null : 'spec must be set'),
    }
    const off = renderForm([gated], {})
    expect(off.sections[0]!.fields[0]!.disabled).toBe(true)
    expect(off.sections[0]!.fields[0]!.disabledReason).toBe('spec must be set')
    const on = renderForm([gated], { spec: 'mtp' })
    expect(on.sections[0]!.fields[0]!.disabled).toBe(false)
    expect(on.sections[0]!.fields[0]!.disabledReason).toBeNull()
  })

  it('renders the port as a number entry and caps the host-KV slider at half the host RAM', () => {
    const hw = {
      hostRamGiB: 32,
      dockerAvailable: false,
      wsl2: false,
      os: 'linux' as const,
      cpuThreads: 8,
    }
    const model = renderForm(NINFER_PARAMETERS, {}, hw)
    const port = model.sections[0]!.fields[0]!
    expect(port.control).toMatchObject({ kind: 'slider', slider: false })
    const kv = model.sections[1]!.fields.find((field) => field.key === 'hostKvMib')!
    // 32 GiB of host RAM caps the range strip at 16384 MiB (half), while the
    // number entry stays uncapped (no static max on the control).
    expect(kv.control.sliderMax).toBe(16384)
    expect('max' in (kv.control as { max?: number })).toBe(false)
  })

  it('caps the default-max-tokens slider at 12.5% of max-context with a 1024 floor', () => {
    const hw = {
      hostRamGiB: 32,
      dockerAvailable: false,
      wsl2: false,
      os: 'linux' as const,
      cpuThreads: 8,
    }
    const model = renderForm(NINFER_PARAMETERS, { maxContext: 32768 }, hw)
    const maxTokens = model.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'defaultMaxTokens')!
    // The 1024 floor lands on the control, and the range strip caps at 12.5%
    // of the live max-context value (32768 -> 4096), re-priced on every render.
    expect(maxTokens.control).toMatchObject({ kind: 'slider', min: 1024 })
    expect(maxTokens.control.sliderMax).toBe(4096)
    // A typed value is never hard-capped by the slider, so the number entry
    // carries no static max.
    expect('max' in (maxTokens.control as { max?: number })).toBe(false)
  })

  it('caps the prefill-chunk slider at max-tokens minus thinking budget, falling back to 10% of max-context', () => {
    const hw = {
      hostRamGiB: 32,
      dockerAvailable: false,
      wsl2: false,
      os: 'linux' as const,
      cpuThreads: 8,
    }
    // The response budget (max tokens minus the thinking budget) caps the
    // strip when it is positive: 4096 - 1024 = 3072.
    const withBudget = renderForm(
      NINFER_PARAMETERS,
      { defaultMaxTokens: 4096, defaultThinkingBudget: 1024, maxContext: 32768 },
      hw,
    )
    const prefill = withBudget.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'prefillChunk')!
    expect(prefill.control.sliderMax).toBe(3072)
    // A missing max tokens (or a thinking budget that swallows it) falls back
    // to 10% of the live max-context value (32768 -> 3276).
    const fallback = renderForm(NINFER_PARAMETERS, { maxContext: 32768 }, hw)
    const prefillFallback = fallback.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'prefillChunk')!
    expect(prefillFallback.control.sliderMax).toBe(3276)
  })

  it('renders the NInfer surface as five sections in first-appearance order', () => {
    const model = renderForm(NINFER_PARAMETERS, {})
    // The port spec opens the surface, so the Engine section (port, prefill,
    // vision, structured output, device profile, chat template) renders first.
    expect(model.sections.map((section) => section.group)).toEqual([
      'Engine',
      'Memory',
      'Concurrency',
      'Speculation',
      'Sampling',
    ])
    expect(model.sections.reduce((sum, section) => sum + section.fields.length, 0)).toBe(
      NINFER_PARAMETERS.length,
    )
    // The defaults land in the fields, and the speculation gate fires on the
    // default config (spec none).
    const port = model.sections[0]!.fields[0]!
    expect(port.key).toBe('port')
    expect(port.value).toBe(18020)
    const kv = model.sections[1]!.fields[0]!
    expect(kv.key).toBe('kvDtype')
    expect(kv.value).toBe('int8')
    const draft = model.sections[3]!.fields.find((field) => field.key === 'draftTokens')!
    expect(draft.disabled).toBe(true)
  })
})
