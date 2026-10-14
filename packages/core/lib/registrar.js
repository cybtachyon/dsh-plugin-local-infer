/**
 * The namespace key of the LLM provider settings entry the registrar writes.
 * The dsh-settings seam keys the profile's plugin entries by these keys; the
 * llm-pi-ai entry owns the providers map the OpenAI-completions models hang
 * off.
 */
export const LLM_PI_AI_NAMESPACE = 'llm-pi-ai';
/**
 * The namespace key of the agent default model settings entry: the provider
 * and model a new agent session starts with.
 */
export const AGENT_DEFAULT_MODEL_NAMESPACE = 'agent-default-model';
/**
 * providerIdFor derives the provider id the registrar writes for an engine:
 * the engine id plus a -local suffix, the naming the profile patch layer
 * uses for local engines.
 */
export function providerIdFor(engineId) {
    return `${engineId}-local`;
}
/**
 * apiKeyEnvFor derives the env-var name a local provider reads its optional
 * API key from: the engine id, uppercased and non-alphanumerics mapped to
 * underscores, plus _LOCAL_API_KEY.
 */
export function apiKeyEnvFor(engineId) {
    return `${engineId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_LOCAL_API_KEY`;
}
/**
 * buildModelEntry turns a launch plan and a model row into the DshModelEntry
 * the registrar writes: the provider id and the API-key env name derive from
 * the plan's engine id, and the base URL is the engine's OpenAI endpoint on
 * its port.
 */
export function buildModelEntry(plan, model) {
    return {
        providerId: providerIdFor(plan.engineId),
        modelId: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        baseURL: `http://127.0.0.1:${plan.port}/v1`,
        apiKeyEnv: apiKeyEnvFor(plan.engineId),
    };
}
/**
 * upsertModelRow returns the models list with the row written: a row the id
 * already names is replaced in place (the registrar is idempotent, so a
 * re-register never duplicates), and a new id appends. Untouched rows keep
 * their extra fields.
 */
export function upsertModelRow(rows, row) {
    const index = rows.findIndex((existing) => existing.id === row.id);
    if (index === -1) {
        return [...rows, row];
    }
    const next = [...rows];
    next[index] = row;
    return next;
}
/**
 * removeModelRow returns the models list without the named model. A model
 * the list does not carry removes nothing, which the removal ops read as
 * "the provider is already clean".
 */
export function removeModelRow(rows, modelId) {
    return rows.filter((row) => row.id !== modelId);
}
/**
 * providerRegistrationOps computes the settings ops that upsert a provider
 * entry: the API-key env name, the openai-completions api, the base URL, and
 * the models list with the entry's row upserted. The ops write the provider
 * fields by path, so a provider the user edited by hand keeps every field
 * the registrar does not own.
 */
export function providerRegistrationOps(entry, rows) {
    const providerPath = ['providers', entry.providerId];
    const row = {
        id: entry.modelId,
        name: entry.name,
        contextWindow: entry.contextWindow,
    };
    return [
        { op: 'set', path: [...providerPath, 'apiKeyEnv'], value: entry.apiKeyEnv },
        { op: 'set', path: [...providerPath, 'api'], value: 'openai-completions' },
        { op: 'set', path: [...providerPath, 'baseURL'], value: entry.baseURL },
        { op: 'set', path: [...providerPath, 'models'], value: upsertModelRow(rows, row) },
    ];
}
/**
 * agentDefaultOps computes the settings ops that point the agent default
 * model at a provider and model: a new agent session starts from there.
 */
export function agentDefaultOps(providerId, modelId) {
    return [
        { op: 'set', path: ['provider'], value: providerId },
        { op: 'set', path: ['model'], value: modelId },
    ];
}
/**
 * providerRemovalOps computes the settings ops that remove a model from a
 * provider: the models list without the row, and the whole provider when the
 * row was the last one, because a models-less provider row is dead weight
 * the settings editor offers no way to edit.
 */
export function providerRemovalOps(providerId, remaining) {
    if (remaining.length === 0) {
        return [{ op: 'unset', path: ['providers', providerId] }];
    }
    return [{ op: 'set', path: ['providers', providerId, 'models'], value: remaining }];
}
/**
 * agentDefaultUnsetOps computes the settings ops that clear the agent
 * default model, so a removed model no longer starts a new session.
 */
export function agentDefaultUnsetOps() {
    return [
        { op: 'unset', path: ['provider'] },
        { op: 'unset', path: ['model'] },
    ];
}
/**
 * modelRowsFrom extracts a provider's current models list from a settings
 * section value: the value the settings seam's describe returns for the
 * llm-pi-ai entry. A value that is not the expected shape reads as an empty
 * list, so a first registration starts from a clean provider.
 */
export function modelRowsFrom(value, providerId) {
    if (value === null || typeof value !== 'object') {
        return [];
    }
    const providers = value.providers;
    if (providers === null || typeof providers !== 'object') {
        return [];
    }
    const provider = providers[providerId];
    if (provider === null || typeof provider !== 'object') {
        return [];
    }
    const models = provider.models;
    if (models === null || !Array.isArray(models)) {
        return [];
    }
    const rows = [];
    for (const entry of models) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }
        const row = entry;
        if (typeof row.id !== 'string') {
            continue;
        }
        rows.push(row);
    }
    return rows;
}
/**
 * agentDefaultPointsAt reports whether the agent default model section
 * points at a provider and model, so a removal can clear the default only
 * when it names the removed pair.
 */
export function agentDefaultPointsAt(value, providerId, modelId) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const section = value;
    return section.provider === providerId && section.model === modelId;
}
//# sourceMappingURL=registrar.js.map