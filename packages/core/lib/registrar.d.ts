import type { LaunchPlan } from './adapter.ts';
/**
 * DshModelEntry is the shape of the model row the registrar writes into the
 * dsh-llm-pi-ai provider: the provider id, the model id and display name, the
 * context window, the engine's base URL, and the env-var name the provider
 * reads its optional API key from.
 */
export interface DshModelEntry {
    providerId: string;
    modelId: string;
    name: string;
    contextWindow: number;
    baseURL: string;
    apiKeyEnv: string;
}
/**
 * RegisterResult reports whether the model was published, with the entry it
 * wrote and a detail for the UI.
 */
export interface RegisterResult {
    ok: boolean;
    entry?: DshModelEntry;
    detail?: string;
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
    id: string;
    name: string;
    contextWindow: number;
}
/**
 * SettingsOp is one path-addressed settings edit: a set writes a value at a
 * path, creating intermediate objects, and an unset removes the path. The
 * shape mirrors the dsh-settings seam's own op type, so the core ops pass
 * through the service without a translation.
 */
export type SettingsOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
/**
 * The namespace key of the LLM provider settings entry the registrar writes.
 * The dsh-settings seam keys the profile's plugin entries by these keys; the
 * llm-pi-ai entry owns the providers map the OpenAI-completions models hang
 * off.
 */
export declare const LLM_PI_AI_NAMESPACE = "llm-pi-ai";
/**
 * The namespace key of the agent default model settings entry: the provider
 * and model a new agent session starts with.
 */
export declare const AGENT_DEFAULT_MODEL_NAMESPACE = "agent-default-model";
/**
 * DshModelRegistrar publishes a confirmed-working engine as a DSH model by
 * upserting the dsh-llm-pi-ai provider through the settings seam, so the
 * change is revision-tracked and undoable. It is idempotent: re-running with
 * the same engine and model updates in place, and stopping the engine can
 * optionally remove the entry.
 */
export interface DshModelRegistrar {
    register(plan: LaunchPlan, modelId: string, name: string, contextWindow: number): Promise<RegisterResult>;
    remove(providerId: string, modelId: string): Promise<void>;
}
/**
 * providerIdFor derives the provider id the registrar writes for an engine:
 * the engine id plus a -local suffix, the naming the profile patch layer
 * uses for local engines.
 */
export declare function providerIdFor(engineId: string): string;
/**
 * apiKeyEnvFor derives the env-var name a local provider reads its optional
 * API key from: the engine id, uppercased and non-alphanumerics mapped to
 * underscores, plus _LOCAL_API_KEY.
 */
export declare function apiKeyEnvFor(engineId: string): string;
/**
 * buildModelEntry turns a launch plan and a model row into the DshModelEntry
 * the registrar writes: the provider id and the API-key env name derive from
 * the plan's engine id, and the base URL is the engine's OpenAI endpoint on
 * its port.
 */
export declare function buildModelEntry(plan: LaunchPlan, model: ModelRow): DshModelEntry;
/**
 * upsertModelRow returns the models list with the row written: a row the id
 * already names is replaced in place (the registrar is idempotent, so a
 * re-register never duplicates), and a new id appends. Untouched rows keep
 * their extra fields.
 */
export declare function upsertModelRow(rows: readonly ModelRow[], row: ModelRow): ModelRow[];
/**
 * removeModelRow returns the models list without the named model. A model
 * the list does not carry removes nothing, which the removal ops read as
 * "the provider is already clean".
 */
export declare function removeModelRow(rows: readonly ModelRow[], modelId: string): ModelRow[];
/**
 * providerRegistrationOps computes the settings ops that upsert a provider
 * entry: the API-key env name, the openai-completions api, the base URL, and
 * the models list with the entry's row upserted. The ops write the provider
 * fields by path, so a provider the user edited by hand keeps every field
 * the registrar does not own.
 */
export declare function providerRegistrationOps(entry: DshModelEntry, rows: readonly ModelRow[]): SettingsOp[];
/**
 * agentDefaultOps computes the settings ops that point the agent default
 * model at a provider and model: a new agent session starts from there.
 */
export declare function agentDefaultOps(providerId: string, modelId: string): SettingsOp[];
/**
 * providerRemovalOps computes the settings ops that remove a model from a
 * provider: the models list without the row, and the whole provider when the
 * row was the last one, because a models-less provider row is dead weight
 * the settings editor offers no way to edit.
 */
export declare function providerRemovalOps(providerId: string, remaining: readonly ModelRow[]): SettingsOp[];
/**
 * agentDefaultUnsetOps computes the settings ops that clear the agent
 * default model, so a removed model no longer starts a new session.
 */
export declare function agentDefaultUnsetOps(): SettingsOp[];
/**
 * modelRowsFrom extracts a provider's current models list from a settings
 * section value: the value the settings seam's describe returns for the
 * llm-pi-ai entry. A value that is not the expected shape reads as an empty
 * list, so a first registration starts from a clean provider.
 */
export declare function modelRowsFrom(value: unknown, providerId: string): readonly ModelRow[];
/**
 * agentDefaultPointsAt reports whether the agent default model section
 * points at a provider and model, so a removal can clear the default only
 * when it names the removed pair.
 */
export declare function agentDefaultPointsAt(value: unknown, providerId: string, modelId: string): boolean;
//# sourceMappingURL=registrar.d.ts.map