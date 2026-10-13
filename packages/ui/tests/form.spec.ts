import { describe, expect, it } from 'vitest'
import {
  GENERAL_GROUP,
  controlFor,
  renderForm,
  resolveValue,
} from '../src/form.ts'
import { NINFER_PARAMETERS } from '@dsh/dsh-plugin-local-infer/providers'
import type {
  Config,
  EnumOption,
  ParameterSpec,
} from '@dsh/dsh-plugin-local-infer/core'

const ENUM_OPTIONS: EnumOption[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
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
  })

  it('leaves optional slider bounds off the control when the spec omits them', () => {
    const control = controlFor({ kind: 'number', min: 1 })
    expect('max' in control).toBe(false)
    expect('step' in control).toBe(false)
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

  it('renders the NInfer surface as five sections in first-appearance order', () => {
    const model = renderForm(NINFER_PARAMETERS, {})
    expect(model.sections.map((section) => section.group)).toEqual([
      'Memory',
      'Concurrency',
      'Speculation',
      'Sampling',
      'Engine',
    ])
    expect(model.sections.reduce((sum, section) => sum + section.fields.length, 0)).toBe(
      NINFER_PARAMETERS.length,
    )
    // The defaults land in the fields, and the speculation gate fires on the
    // default config (spec none).
    const kv = model.sections[0]!.fields[0]!
    expect(kv.key).toBe('kvDtype')
    expect(kv.value).toBe('int8')
    const draft = model.sections[2]!.fields.find((field) => field.key === 'draftTokens')!
    expect(draft.disabled).toBe(true)
  })
})
