import type { Config } from './config.ts'
import type { HardwareProfile } from './hardware.ts'
import type { ParameterSpec } from './parameter.ts'

/**
 * HardwareClass is the coarse capability bucket a preset is sourced for, e.g.
 * "24g-sm86" for a 24 GiB Ampere card. A preset is only trusted for the exact
 * (engine, model, hardware class) it was sourced for.
 */
export type HardwareClass = string

/**
 * Preset is a starting Config for one (engine, model, hardware class), tagged
 * with its source and fetch date so the UI can show provenance. A `label`
 * names a distinct preset that shares a triple (the Hyper-Qwen speed,
 * long-context, and huge-context tiers all target the same card), and
 * `isDefault` marks the one the resolver auto-picks when several share a
 * triple.
 */
export interface Preset {
  engineId: string
  modelId: string
  hardwareClass: HardwareClass
  values: Config
  source: string
  fetchedAt?: string
  label?: string
  isDefault?: boolean
}

/**
 * DefaultProvenance reports which source supplied one value, so the UI can show
 * "sourced from NInfer docs (fetched 2026-10-13)".
 */
export interface DefaultProvenance {
  key: string
  source: string
}

/**
 * DefaultsResolver resolves a starting Config for (engineId, modelId,
 * hardware class). Resolution order: explicit user value, engine/model preset
 * for the detected hardware class, built-in preset, then the ParameterSpec
 * defaultValue. The resolver reports which source supplied each value.
 */
export interface DefaultsResolver {
  resolve(
    engineId: string,
    modelId: string,
    hw: HardwareProfile,
    explicit?: Config,
  ): {
    config: Config
    provenance: DefaultProvenance[]
  }
}

/**
 * ResolvedDefaults is the answer to a defaults resolution: the starting
 * Config and the per-key provenance that names the source that supplied each
 * value, so the UI can show "sourced from NInfer docs (fetched 2026-10-13)".
 */
export interface ResolvedDefaults {
  config: Config
  provenance: DefaultProvenance[]
}

/**
 * The wildcard hardware class a built-in (hardware-agnostic) preset is keyed
 * by. A preset is only trusted for the exact class it was sourced for, so the
 * wildcard is the one class that means "any detected hardware".
 */
export const WILDCARD_HARDWARE_CLASS: HardwareClass = '*'

/**
 * hardwareClass turns a HardwareProfile into the coarse capability bucket a
 * preset is sourced for: the VRAM in GiB (rounded) plus the SM architecture,
 * e.g. "24g-sm86" for a 24 GiB Ampere card. A host with no detected GPU has no
 * class, which the resolver reads as "no exact-class preset applies".
 */
export function hardwareClass(hw: HardwareProfile): HardwareClass | undefined {
  const gpu = hw.gpu
  if (gpu === undefined) return undefined
  return `${Math.round(gpu.vramGiB)}g-sm${gpu.sm}`
}

/**
 * PresetSource declares where an externally-sourced preset comes from: the
 * engine and model it names, the hardware class it is trusted for, the URL the
 * mod-search bridge fetches, and the pure extractor that turns the fetched
 * page content into the preset values. The fetch path (the service) runs the
 * extractor and tags the result with the URL and the fetch date.
 */
export interface PresetSource {
  engineId: string
  modelId: string
  hardwareClass: HardwareClass
  url: string
  source: string
  extract: (content: string) => Config
}

/**
 * presetFromFetch turns one fetched page into the Preset a PresetSource
 * names: the source's engine, model, and class, the values the extractor
 * pulled from the content, the source URL as the provenance tag, and the
 * fetch date. The result is ready to register and persist.
 */
export function presetFromFetch(source: PresetSource, content: string, fetchedAt: string): Preset {
  return {
    engineId: source.engineId,
    modelId: source.modelId,
    hardwareClass: source.hardwareClass,
    values: source.extract(content),
    source: source.url,
    fetchedAt,
  }
}

/**
 * resolveDefaults resolves the starting Config for one (engine, model,
 * hardware) over the registered presets and the engine's parameter surface.
 * Resolution order, per key: the explicit user value, the preset for the
 * detected hardware class, the built-in (wildcard) preset, then the
 * ParameterSpec defaultValue. The provenance list names the source that
 * supplied each value in the result, in key order.
 */
export function resolveDefaults(
  presets: readonly Preset[],
  specs: readonly ParameterSpec[],
  engineId: string,
  modelId: string,
  hw: HardwareProfile,
  explicit?: Config,
): ResolvedDefaults {
  const detected = hardwareClass(hw)
  const forEngineModel = presets.filter(
    (preset) => preset.engineId === engineId && preset.modelId === modelId,
  )
  // Several presets can share a triple (the Hyper-Qwen tiers); the resolver
  // auto-picks the one marked isDefault, falling back to the first registered.
  const exactMatches =
    detected !== undefined
      ? forEngineModel.filter((preset) => preset.hardwareClass === detected)
      : []
  const exact = exactMatches.find((preset) => preset.isDefault === true) ?? exactMatches[0]
  const builtin = forEngineModel.find((preset) => preset.hardwareClass === WILDCARD_HARDWARE_CLASS)

  // The floor is the spec defaultValue for every spec that carries one, so
  // the result is a complete starting config, not a partial one.
  const config: Config = {}
  const sources = new Map<string, string>()
  for (const spec of specs) {
    if (spec.defaultValue !== undefined) {
      config[spec.key] = spec.defaultValue
      sources.set(spec.key, 'spec-default')
    }
  }
  // Overlay the built-in preset, then the exact-class preset, so the more
  // specific source wins per key.
  overlayPreset(builtin, config, sources)
  overlayPreset(exact, config, sources)
  if (explicit !== undefined) {
    for (const [key, value] of Object.entries(explicit)) {
      if (value === undefined) continue
      config[key] = value
      sources.set(key, 'user')
    }
  }
  const provenance: DefaultProvenance[] = [...sources.entries()]
    .map(([key, source]) => ({ key, source }))
    .sort((a, b) => a.key.localeCompare(b.key))
  return { config, provenance }
}

/**
 * overlayPreset writes one preset's values over the running config and
 * records the preset's source per key, so the provenance names the preset
 * that last supplied each value.
 */
function overlayPreset(
  preset: Preset | undefined,
  config: Config,
  sources: Map<string, string>,
): void {
  if (preset === undefined) return
  for (const [key, value] of Object.entries(preset.values)) {
    if (value === undefined) continue
    config[key] = value
    sources.set(key, preset.source)
  }
}
