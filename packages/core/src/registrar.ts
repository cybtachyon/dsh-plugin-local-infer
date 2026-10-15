import type { LaunchPlan } from './adapter.ts'

/**
 * DshModelEntry is the shape of the model row the registrar writes into the
 * dsh-llm-pi-ai provider: the provider id, the model id and display name, the
 * context window, the engine's base URL, and the env-var name the provider
 * reads its optional API key from.
 */
export interface DshModelEntry {
  providerId: string
  modelId: string
  name: string
  contextWindow: number
  baseURL: string
  apiKeyEnv: string
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
 * ModelRow is one row of a provider's models list: the id the engine
 * advertises on its OpenAI endpoint, the display name DSH shows, and the
 * context window DSH offers the model for. A row may carry extra fields the
 * settings editor owns (input modalities, for example), so the registrar
 * treats the rows it does not touch as opaque and only replaces the row it
 * writes.
 */
export interface ModelRow {
  id: string
  name: string
  contextWindow: number
}

/**
 * SettingsOp is one path-addressed settings edit: a set writes a value at a
 * path, creating intermediate objects, and an unset removes the path. The
 * shape mirrors the dsh-settings seam's own op type, so the core ops pass
 * through the service without a translation.
 */
export type SettingsOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/**
 * The namespace key of the LLM provider settings entry the registrar writes.
 * The dsh-settings seam keys the profile's plugin entries by these keys; the
 * llm-pi-ai entry owns the providers map the OpenAI-completions models hang
 * off.
 */
export const LLM_PI_AI_NAMESPACE = 'llm-pi-ai'

/**
 * The namespace key of the agent default model settings entry: the provider
 * and model a new agent session starts with.
 */
export const AGENT_DEFAULT_MODEL_NAMESPACE = 'agent-default-model'

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

/**
 * modelSlug reduces a model id to a short, stable slug: lowercased, dots
 * dropped (model version separators), other non-alphanumerics mapped to
 * single dashes, and truncated to 24 characters so a long model id does not
 * bloat the provider id.
 */
export function modelSlug(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 24 ? slug.slice(0, 24) : slug
}

/**
 * providerIdFor derives the provider id the registrar writes for an engine
 * and model: the engine id, the build mode (local or docker), and the model
 * slug, so a profile can carry the same engine in both build modes and
 * several models per engine without a collision.
 */
export function providerIdFor(
  engineId: string,
  modelId: string,
  buildMode: 'local' | 'docker',
): string {
  return `${engineId}-${buildMode}-${modelSlug(modelId)}`
}

/**
 * apiKeyEnvFor derives the env-var name a local provider reads its optional
 * API key from: the engine id, uppercased and non-alphanumerics mapped to
 * underscores, plus _LOCAL_API_KEY.
 */
export function apiKeyEnvFor(engineId: string): string {
  return `${engineId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_LOCAL_API_KEY`
}

/**
 * engineDisplayName capitalizes the first letter of an engine id for the
 * display name: `ninfer` reads as `Ninfer`, `hyperqwen` as `Hyperqwen`.
 */
function engineDisplayName(engineId: string): string {
  return engineId.charAt(0).toUpperCase() + engineId.slice(1)
}

/**
 * buildModelEntry turns a launch plan and a model row into the DshModelEntry
 * the registrar writes. The provider id is the engine, build mode, and model
 * slug; the display name is the engine, the build mode in parentheses, and
 * the model name (falling back to the slug when the row carries none). The
 * API-key env name derives from the engine id, and the base URL is the
 * engine's OpenAI endpoint on its port.
 */
export function buildModelEntry(plan: LaunchPlan, model: ModelRow): DshModelEntry {
  const buildMode: 'local' | 'docker' = plan.kind === 'docker' ? 'docker' : 'local'
  const modeLabel = buildMode === 'docker' ? 'Docker' : 'Local'
  const modelName = model.name !== '' ? model.name : modelSlug(model.id)
  return {
    providerId: providerIdFor(plan.engineId, model.id, buildMode),
    modelId: model.id,
    name: `${engineDisplayName(plan.engineId)} (${modeLabel}): ${modelName}`,
    contextWindow: model.contextWindow,
    baseURL: `http://127.0.0.1:${plan.port}/v1`,
    apiKeyEnv: apiKeyEnvFor(plan.engineId),
  }
}

/**
 * upsertModelRow returns the models list with the row written: a row the id
 * already names is replaced in place (the registrar is idempotent, so a
 * re-register never duplicates), and a new id appends. Untouched rows keep
 * their extra fields.
 */
export function upsertModelRow(rows: readonly ModelRow[], row: ModelRow): ModelRow[] {
  const index = rows.findIndex((existing) => existing.id === row.id)
  if (index === -1) {
    return [...rows, row]
  }
  const next = [...rows]
  next[index] = row
  return next
}

/**
 * removeModelRow returns the models list without the named model. A model
 * the list does not carry removes nothing, which the removal ops read as
 * "the provider is already clean".
 */
export function removeModelRow(rows: readonly ModelRow[], modelId: string): ModelRow[] {
  return rows.filter((row) => row.id !== modelId)
}

/**
 * providerRegistrationOps computes the settings ops that upsert a provider
 * entry: the API-key env name, the openai-completions api, the base URL, and
 * the models list with the entry's row upserted. The ops write the provider
 * fields by path, so a provider the user edited by hand keeps every field
 * the registrar does not own.
 */
export function providerRegistrationOps(
  entry: DshModelEntry,
  rows: readonly ModelRow[],
): SettingsOp[] {
  const providerPath = ['providers', entry.providerId]
  const row: ModelRow = {
    id: entry.modelId,
    name: entry.name,
    contextWindow: entry.contextWindow,
  }
  return [
    { op: 'set', path: [...providerPath, 'apiKeyEnv'], value: entry.apiKeyEnv },
    { op: 'set', path: [...providerPath, 'api'], value: 'openai-completions' },
    { op: 'set', path: [...providerPath, 'baseURL'], value: entry.baseURL },
    { op: 'set', path: [...providerPath, 'models'], value: upsertModelRow(rows, row) },
  ]
}

/**
 * agentDefaultOps computes the settings ops that point the agent default
 * model at a provider and model: a new agent session starts from there.
 */
export function agentDefaultOps(providerId: string, modelId: string): SettingsOp[] {
  return [
    { op: 'set', path: ['provider'], value: providerId },
    { op: 'set', path: ['model'], value: modelId },
  ]
}

/**
 * providerRemovalOps computes the settings ops that remove a model from a
 * provider: the models list without the row, and the whole provider when the
 * row was the last one, because a models-less provider row is dead weight
 * the settings editor offers no way to edit.
 */
export function providerRemovalOps(
  providerId: string,
  remaining: readonly ModelRow[],
): SettingsOp[] {
  if (remaining.length === 0) {
    return [{ op: 'unset', path: ['providers', providerId] }]
  }
  return [{ op: 'set', path: ['providers', providerId, 'models'], value: remaining }]
}

/**
 * agentDefaultUnsetOps computes the settings ops that clear the agent
 * default model, so a removed model no longer starts a new session.
 */
export function agentDefaultUnsetOps(): SettingsOp[] {
  return [
    { op: 'unset', path: ['provider'] },
    { op: 'unset', path: ['model'] },
  ]
}

/**
 * modelRowsFrom extracts a provider's current models list from a settings
 * section value: the value the settings seam's describe returns for the
 * llm-pi-ai entry. A value that is not the expected shape reads as an empty
 * list, so a first registration starts from a clean provider.
 */
export function modelRowsFrom(value: unknown, providerId: string): readonly ModelRow[] {
  if (value === null || typeof value !== 'object') {
    return []
  }
  const providers = (value as Record<string, unknown>).providers
  if (providers === null || typeof providers !== 'object') {
    return []
  }
  const provider = (providers as Record<string, unknown>)[providerId]
  if (provider === null || typeof provider !== 'object') {
    return []
  }
  const models = (provider as Record<string, unknown>).models
  if (models === null || !Array.isArray(models)) {
    return []
  }
  const rows: ModelRow[] = []
  for (const entry of models) {
    if (entry === null || typeof entry !== 'object') {
      continue
    }
    const row = entry as ModelRow
    if (typeof row.id !== 'string') {
      continue
    }
    rows.push(row)
  }
  return rows
}

/**
 * agentDefaultPointsAt reports whether the agent default model section
 * points at a provider and model, so a removal can clear the default only
 * when it names the removed pair.
 */
export function agentDefaultPointsAt(
  value: unknown,
  providerId: string,
  modelId: string,
): boolean {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const section = value as Record<string, unknown>
  return section.provider === providerId && section.model === modelId
}
