import type { LaunchPlan } from './adapter.ts'

/**
 * DshModelEntry is the shape of the model row the registrar writes into the
 * dsh-llm-pi-ai provider: the provider id, the model id and display name, the
 * context window, and the engine's base URL.
 */
export interface DshModelEntry {
  providerId: string
  modelId: string
  name: string
  contextWindow: number
  baseURL: string
}

/**
 * RegisterResult reports whether the model was published, with the entry it
 * wrote and a detail for the UI.
 */
export interface RegisterResult {
  ok: boolean
  entry?: DshModelEntry
  detail?: string
}

/**
 * DshModelRegistrar publishes a confirmed-working engine as a DSH model by
 * upserting the dsh-llm-pi-ai provider through the settings seam, so the
 * change is revision-tracked and undoable. It is idempotent: re-running with
 * the same engine and model updates in place, and stopping the engine can
 * optionally remove the entry.
 */
export interface DshModelRegistrar {
  register(
    plan: LaunchPlan,
    modelId: string,
    name: string,
    contextWindow: number,
  ): Promise<RegisterResult>
  remove(providerId: string, modelId: string): Promise<void>
}
