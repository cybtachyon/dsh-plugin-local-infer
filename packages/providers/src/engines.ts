/**
 * EngineInfo is the static, UI-facing description of one local-inference
 * engine: its id, display label, the deploy modes it supports, and the
 * ParameterSpec surface the form renderer draws. The data is the surface; the
 * concrete EngineAdapter (Phase 5) composes it into a LaunchPlan. The registry
 * is the single list the Web card offers, so adding an engine is a data edit
 * here, never a rewire of the card.
 * @module @dsh/dsh-plugin-local-infer/providers/engines
 */

import type { ParameterSpec } from '@dsh/dsh-plugin-local-infer/core'
import { HYPERQWEN_PARAMETERS } from './hyperqwen.ts'
import { NINFER_PARAMETERS } from './ninfer.ts'

export interface EngineInfo {
  id: string
  label: string
  supports: { docker: boolean; local: boolean }
  parameters: readonly ParameterSpec[]
}

/**
 * The engines the Web card offers, in the order the card lists them. NInfer and
 * Hyper-Qwen carry measured parameter surfaces; llama.cpp and Strata land their
 * surfaces in a later phase, so they render an empty form until then.
 */
export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'ninfer',
    label: 'NInfer',
    supports: { docker: true, local: true },
    parameters: NINFER_PARAMETERS,
  },
  {
    id: 'hyperqwen',
    label: 'Hyper-Qwen',
    supports: { docker: true, local: false },
    parameters: HYPERQWEN_PARAMETERS,
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    supports: { docker: true, local: true },
    parameters: [],
  },
  {
    id: 'strata',
    label: 'Strata',
    supports: { docker: true, local: false },
    parameters: [],
  },
]
