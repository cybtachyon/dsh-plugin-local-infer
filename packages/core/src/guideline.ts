import type { Config } from './config.ts'
import type { HardwareProfile } from './hardware.ts'
import type { ParameterSpec } from './parameter.ts'

/**
 * Guideline is a named rule that inspects a parameter value, or the presence of
 * a parameter, and returns a severity. This directly serves the requirement to
 * warn when parameter values OR parameters themselves are a problem for the
 * hardware. `error` renders red, inline to the anchored parameter and in the
 * summary banner.
 */
export interface Guideline {
  id: string
  when: (config: Config, hw: HardwareProfile, spec?: ParameterSpec) => boolean
  level: 'info' | 'warn' | 'error'
  message: string
  anchors?: string[]
}

/**
 * GuidelineResult is one fired guideline, with the parameter keys it anchors
 * to for inline placement in the form.
 */
export interface GuidelineResult {
  id: string
  level: 'info' | 'warn' | 'error'
  message: string
  anchors?: string[]
}
