/**
 * The DSH model registration operations: registerFor upserts the provider
 * and model through the settings seam, unregisterFor removes the exact entry
 * the registration wrote, and syncRegisteredModel re-runs the registration on
 * a save so the registered model's input types stay in step with the config.
 * resolveModelRow and resolveContextWindow resolve the row and context window
 * the registrar publishes; resolveModelDirectory picks the model directory a
 * Get run downloads into.
 * @module dsh-plugin-local-infer/ui/ops/model
 */
import type { Config, ModelRow, RegisterResult, VramModel } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { RegisterRequest } from '../request.ts';
/**
 * resolveContextWindow picks the context window the registrar publishes: the
 * config's maxContext when it names one, else the native ceiling of the
 * VramModel the config resolves to (the named model, or the single
 * registered model), else the 32768 spec default. The DSH contextWindow must
 * not promise a context the engine cannot serve, so the ceiling is the
 * model's own, not an optimistic number.
 */
export declare function resolveContextWindow(config: Config, models: readonly VramModel[]): number;
/**
 * resolveModelRow picks the model row the registrar publishes for an engine
 * and config: the adapter's modelRef (the id the engine serves on its
 * OpenAI endpoint) when it declares one, else the plan's model id, else the
 * engine id. The display name follows the same fall-through.
 */
export declare function resolveModelRow(adapter: {
    id: string;
    modelRef?(config: Config): {
        id: string;
        name: string;
    } | undefined;
}, plan: {
    modelId?: string;
}, config: Config): ModelRow;
/**
 * registerFor renders the plan through the registered adapter, resolves the
 * model row and the context window, and runs the service's register entry
 * point, which upserts the provider and model through the settings seam.
 * The result carries the entry the registrar wrote, so the card names the
 * model it published.
 */
export declare function registerFor(localInfer: LocalInferService, request?: RegisterRequest): Promise<RegisterResult>;
/**
 * syncRegisteredModel re-runs the registration for a saved config when the
 * model is already registered in the DSH settings, so the registered model's
 * input types (the vision flag) stay in step with the saved config. A model
 * that is not registered (a fresh save) is a no-op, and a profile without the
 * settings seam throws, which the save route catches and swallows so the save
 * itself never fails on a sync that cannot run.
 */
export declare function syncRegisteredModel(localInfer: LocalInferService, engine: string, config: Config): Promise<void>;
/**
 * unregisterFor runs the service's removeModel entry point for the engine's
 * provider and the model row the register step resolved, so the removal
 * targets the exact entry the registration wrote.
 */
export declare function unregisterFor(localInfer: LocalInferService, request?: RegisterRequest): Promise<{
    removed: boolean;
}>;
/**
 * resolveModelDirectory picks the model directory a Get run downloads into:
 * the config's modelDirectory override when it names a path, else the
 * plugin's default model directory. The same rule the summary and deps routes
 * apply, so a Get and the card's Model Directory field agree on the target.
 */
export declare function resolveModelDirectory(localInfer: LocalInferService, config: Config): string;
//# sourceMappingURL=model.d.ts.map