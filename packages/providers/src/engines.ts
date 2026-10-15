/**
 * EngineInfo is the static, UI-facing description of one local-inference
 * engine: its id, display label, the deploy modes it supports, and the
 * ParameterSpec surface the form renderer draws. The data is the surface; the
 * concrete EngineAdapter (Phase 5) composes it into a LaunchPlan. The registry
 * is the single list the Web card offers, so adding an engine is a data edit
 * here, never a rewire of the card.
 * @module dsh-plugin-local-infer/providers/engines
 */

import type { ParameterSpec } from 'dsh-plugin-local-infer/core'
import { HYPERQWEN_PARAMETERS } from './hyperqwen.ts'
import { LLAMACPP_PARAMETERS } from './llamacpp.ts'
import { NINFER_PARAMETERS } from './ninfer.ts'
import { STRATA_PARAMETERS } from './strata.ts'

export interface EngineInfo {
  id: string
  label: string
  supports: { docker: boolean; local: boolean }
  parameters: readonly ParameterSpec[]
}

/**
 * The engines the Web card offers, in the order the card lists them. NInfer,
 * Hyper-Qwen, and llama.cpp carry parameter surfaces (llama.cpp's is the
 * specified set the plan names, verified when the binary lands); Strata is the
 * placeholder engine, its surface empty until the engine's flag set lands.
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
    parameters: LLAMACPP_PARAMETERS,
  },
  {
    id: 'strata',
    label: 'Strata',
    supports: { docker: true, local: false },
    parameters: STRATA_PARAMETERS,
  },
]
