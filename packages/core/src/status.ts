import { GPU_USAGE_BUSY_THRESHOLD } from './reserve.ts'
import type { GpuUsageProbe } from './reserve.ts'

/**
 * ProviderStatus is the running-state the plugin card paints each saved
 * provider's status dot: green while the engine is confirmed serving the
 * model, red while the engine is not running, and yellow (unsure) while the
 * detector cannot tell which model, if any, is live.
 */
export type ProviderStatus = 'running' | 'stopped' | 'unsure'

/**
 * ProviderRef is the identity side of one saved provider config: the stable
 * id the card renders and the engine and model it serves. The model is
 * optional because a config that names no model cannot be confirmed against
 * a running engine, and reads as unsure rather than a guess.
 */
export interface ProviderRef {
  id: string
  engine: string
  model?: string
}

/**
 * RunningEngineRef is one engine the detector confirmed live: the engine id,
 * the port it binds when the signature carries one, and the model it serves
 * when the detector could identify it. A ref without a modelId is an engine
 * the detector saw running but could not tie to a model, which is the
 * "engine running, model unknown" case that reads as unsure.
 */
export interface RunningEngineRef {
  engineId: string
  port?: number
  modelId?: string
}

/**
 * ProviderStatusInput is the detector's answer the pure resolver consumes:
 * the saved providers, the engines the process probe confirmed running, and
 * whether the card is busy (its VRAM usage at the 75% threshold). The
 * resolver is a pure function of these, so a test prices a busy card or a
 * foreign engine without a live nvidia-smi or ps.
 */
export interface ProviderStatusInput {
  providers: readonly ProviderRef[]
  running: readonly RunningEngineRef[]
  gpuBusy: boolean
}

/**
 * isGpuBusy reports whether a GPU usage reading reads the card as busy: the
 * used VRAM at 75% of the total or more. A missing reading or an empty total
 * is not busy, so a host the detector cannot read never reads as busy.
 */
export function isGpuBusy(usage?: GpuUsageProbe | null): boolean {
  if (usage === null || usage === undefined) return false
  if (usage.totalMiB <= 0) return false
  return usage.usedMiB / usage.totalMiB >= GPU_USAGE_BUSY_THRESHOLD
}

/**
 * computeProviderStatuses resolves each saved provider's running-state from
 * the detector's answer. The order is the plan's contract:
 * 1. A provider whose engine the process probe confirmed running is running
 *    (green) when the detector tied that engine to the provider's exact model,
 *    and unsure (yellow) when the engine serves an unidentified or a
 *    different model. A running engine using its VRAM does not read as a busy
 *    card, so the dot is green, not the unattributable yellow.
 * 2. A provider whose engine is not running falls back to the card state: a
 *    busy card (a foreign engine holding the VRAM at 75% or more) reads as
 *    unsure, because a full card cannot be attributed to a single model, and
 *    a quiet card reads as stopped (red): the process probe saw no engine, so
 *    a saved config whose engine is down is stopped.
 */
export function computeProviderStatuses(
  input: ProviderStatusInput,
): Record<string, ProviderStatus> {
  const statuses: Record<string, ProviderStatus> = {}
  for (const provider of input.providers) {
    const matches = input.running.filter((ref) => ref.engineId === provider.engine)
    if (matches.length > 0) {
      // The engine is running. The question is which model it serves: the
      // detector's identified model, if it tied one, else unknown.
      const identified = matches.find((ref) => ref.modelId !== undefined && ref.modelId !== '')
      if (
        identified !== undefined &&
        provider.model !== undefined &&
        identified.modelId === provider.model
      ) {
        statuses[provider.id] = 'running'
        continue
      }
      // The engine is running but the model is not identified, the provider
      // names no model, or the engine serves a different model: unsure, not
      // a guess.
      statuses[provider.id] = 'unsure'
      continue
    }
    // No engine of this provider's is running. A busy card (a foreign engine
    // holding the VRAM) reads as unsure; a quiet card reads as stopped.
    statuses[provider.id] = input.gpuBusy ? 'unsure' : 'stopped'
  }
  return statuses
}
