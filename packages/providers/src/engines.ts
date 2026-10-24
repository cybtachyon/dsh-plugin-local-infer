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
import { INFERNIX_PARAMETERS } from './infernix.ts'
import { LLAMACPP_PARAMETERS } from './llamacpp.ts'
import { NINFER_PARAMETERS } from './ninfer.ts'
import { STRATA_PARAMETERS } from './strata.ts'

export interface EngineInfo {
  id: string
  label: string
  supports: { docker: boolean; local: boolean; binary?: boolean }
  parameters: readonly ParameterSpec[]
}

/**
 * The engines the Web card offers, in the order the card lists them. NInfer,
 * Hyper-Qwen, Infernix, llama.cpp, and Strata all carry parameter surfaces
 * (llama.cpp's is the specified set the plan names, verified when the binary
 * lands); Strata's surface is the `strata launch` flags and it supports all
 * three build modes (docker, source build, and the binary install).
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
    id: 'infernix',
    label: 'Infernix',
    supports: { docker: false, local: true },
    parameters: INFERNIX_PARAMETERS,
  },
  {
    id: 'strata',
    label: 'Strata',
    supports: { docker: true, local: true, binary: true },
    parameters: STRATA_PARAMETERS,
  },
]
