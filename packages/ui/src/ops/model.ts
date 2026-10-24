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

import type { Config, ModelRow, RegisterResult, VramModel } from 'dsh-plugin-local-infer/core'
import { buildModelEntry, providerIdFor } from '../../../core/lib/index.js'
import type { LocalInferService, RegisterModelOptions } from 'dsh-plugin-local-infer/service'
import { readConfig } from '../config.ts'
import type { RegisterRequest } from '../request.ts'
import { resolveAdapter } from './engine.ts'

/**
 * resolveContextWindow picks the context window the registrar publishes: the
 * config's maxContext when it names one, else the native ceiling of the
 * VramModel the config resolves to (the named model, or the single
 * registered model), else the 32768 spec default. The DSH contextWindow must
 * not promise a context the engine cannot serve, so the ceiling is the
 * model's own, not an optimistic number.
 */
export function resolveContextWindow(config: Config, models: readonly VramModel[]): number {
  const configured = config.maxContext
  if (typeof configured === 'number' && configured > 0) {
    return configured
  }
  let model: VramModel | undefined
  if (typeof config.model === 'string') {
    model = models.find((entry) => entry.id === config.model)
  } else if (models.length === 1) {
    model = models[0]
  }
  return model?.nativeMaxContext ?? 32768
}

/**
 * resolveModelRow picks the model row the registrar publishes for an engine
 * and config: the adapter's modelRef (the id the engine serves on its
 * OpenAI endpoint) when it declares one, else the plan's model id, else the
 * engine id. The display name follows the same fall-through.
 */
export function resolveModelRow(
  adapter: { id: string; modelRef?(config: Config): { id: string; name: string } | undefined },
  plan: { modelId?: string },
  config: Config,
): ModelRow {
  const ref = adapter.modelRef?.(config)
  const id = ref?.id ?? plan.modelId ?? adapter.id
  return { id, name: ref?.name ?? id, contextWindow: 0 }
}

/**
 * registerFor renders the plan through the registered adapter, resolves the
 * model row and the context window, and runs the service's register entry
 * point, which upserts the provider and model through the settings seam.
 * The result carries the entry the registrar wrote, so the card names the
 * model it published.
 */
export async function registerFor(
  localInfer: LocalInferService,
  request?: RegisterRequest,
): Promise<RegisterResult> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  const row = resolveModelRow(adapter, plan, config)
  row.contextWindow = resolveContextWindow(config, localInfer.registeredVramModels())
  // The vision flag publishes the Image input type on the DSH model row, so a
  // vision engine advertises ['text', 'image'] and a text-only engine
  // ['text']. The registrar copies it into the entry it writes.
  row.input = config.vision === true ? ['text', 'image'] : ['text']
  const options: RegisterModelOptions | undefined =
    request?.agentDefault === true ? { agentDefault: true } : undefined
  return localInfer.registerModel(plan, row, options)
}

/**
 * syncRegisteredModel re-runs the registration for a saved config when the
 * model is already registered in the DSH settings, so the registered model's
 * input types (the vision flag) stay in step with the saved config. A model
 * that is not registered (a fresh save) is a no-op, and a profile without the
 * settings seam throws, which the save route catches and swallows so the save
 * itself never fails on a sync that cannot run.
 */
export async function syncRegisteredModel(
  localInfer: LocalInferService,
  engine: string,
  config: Config,
): Promise<void> {
  const adapter = resolveAdapter(localInfer, engine)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  const row = resolveModelRow(adapter, plan, config)
  const buildMode = plan.kind === 'docker' ? 'docker' : 'local'
  const providerId = providerIdFor(adapter.id, row.id, buildMode)
  if (await localInfer.modelIsRegistered(providerId, row.id)) {
    await registerFor(localInfer, { engine, config })
  }
}

/**
 * unregisterFor runs the service's removeModel entry point for the engine's
 * provider and the model row the register step resolved, so the removal
 * targets the exact entry the registration wrote.
 */
export async function unregisterFor(
  localInfer: LocalInferService,
  request?: RegisterRequest,
): Promise<{ removed: boolean }> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  const adapter = resolveAdapter(localInfer, engineId)
  const hardware = await localInfer.detectHardware()
  const plan = adapter.renderLaunch(config, hardware)
  const row = resolveModelRow(adapter, plan, config)
  // The removal must target the exact entry the register step wrote, so the
  // provider id is computed through buildModelEntry (the same function the
  // register step uses) rather than a parallel providerIdFor call, which
  // could drift if plan.engineId and adapter.id ever diverge.
  const entry = buildModelEntry(plan, row)
  await localInfer.removeModel(entry.providerId, row.id)
  return { removed: true }
}

/**
 * resolveModelDirectory picks the model directory a Get run downloads into:
 * the config's modelDirectory override when it names a path, else the
 * plugin's default model directory. The same rule the summary and deps routes
 * apply, so a Get and the card's Model Directory field agree on the target.
 */
export function resolveModelDirectory(localInfer: LocalInferService, config: Config): string {
  const rawModelDir = config.modelDirectory
  return typeof rawModelDir === 'string' && rawModelDir.trim() !== ''
    ? rawModelDir
    : localInfer.defaultModelDirectory()
}
