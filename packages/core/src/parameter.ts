import type { Config } from './config.ts'
import type { EstimateContext, VramContribution } from './estimator.ts'
import type { HardwareProfile } from './hardware.ts'

/**
 * EnumOption is one choice in an enum form. `note` carries the free-form
 * tradeoff text, e.g. "rk4v4: the context choice, 31% smaller than rk8v4".
 */
export interface EnumOption {
  value: string
  label: string
  note?: string
}

/**
 * ComboOption is one known choice in a combo form (dropdown plus free text).
 * `source` tags where the option came from ('engine' | 'popular' | 'added'),
 * so the renderer can group and order its entries, and 'added' marks the
 * user-typed values the plugin persists for re-selection.
 */
export interface ComboOption {
  value: string
  label: string
  note?: string
  source?: 'engine' | 'popular' | 'added'
}

/**
 * ConstraintResult is the answer to a parameter's hardwareConstraint probe:
 * ok, or a severity and a human-readable message naming the fix.
 */
export type ConstraintResult =
  | { ok: true }
  | { ok: false; severity: 'warn' | 'error'; message: string }

/**
 * ParameterForm is the closed union of control kinds the renderer switches on:
 * checkbox, dropdown, slider plus number, text, a directory/file picker, and a
 * dropdown plus free-text combo for known-options fields (the chat template).
 */
export type ParameterForm =
  | { kind: 'boolean' }
  | { kind: 'enum'; options: EnumOption[] }
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'path' }
  | { kind: 'combo'; options: ComboOption[] }

/**
 * ParameterSpec is the unit of parameter management: a declarative description
 * of one engine parameter. It is the object that makes the parameter-to-
 * hardware relationship first-class. A parameter declares its VRAM
 * contribution and its hardware constraint; the estimator and the guideline
 * engine consume those declarations. Adding a new engine or model is a matter
 * of adding these specs, never rewiring the core.
 *
 * `description` is behavior-first: it says what the parameter does to the run,
 * not what it is. `toArgv` and `toEnv` are the engine-specific spellings that
 * turn a value into a CLI flag or an environment variable.
 */
export interface ParameterSpec {
  key: string
  label: string
  description: string
  form: ParameterForm
  defaultValue?: unknown
  group?: string
  vramContribution?: (value: unknown, ctx: EstimateContext) => VramContribution
  hardwareConstraint?: (value: unknown, hw: HardwareProfile) => ConstraintResult
  requires?: (config: Config) => string | null
  toArgv?: (value: unknown) => string[]
  toEnv?: (value: unknown) => [string, string]
}
