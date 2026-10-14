/**
 * The wildcard hardware class a built-in (hardware-agnostic) preset is keyed
 * by. A preset is only trusted for the exact class it was sourced for, so the
 * wildcard is the one class that means "any detected hardware".
 */
export const WILDCARD_HARDWARE_CLASS = '*';
/**
 * hardwareClass turns a HardwareProfile into the coarse capability bucket a
 * preset is sourced for: the VRAM in GiB (rounded) plus the SM architecture,
 * e.g. "24g-sm86" for a 24 GiB Ampere card. A host with no detected GPU has no
 * class, which the resolver reads as "no exact-class preset applies".
 */
export function hardwareClass(hw) {
    const gpu = hw.gpu;
    if (gpu === undefined)
        return undefined;
    return `${Math.round(gpu.vramGiB)}g-sm${gpu.sm}`;
}
/**
 * presetFromFetch turns one fetched page into the Preset a PresetSource
 * names: the source's engine, model, and class, the values the extractor
 * pulled from the content, the source URL as the provenance tag, and the
 * fetch date. The result is ready to register and persist.
 */
export function presetFromFetch(source, content, fetchedAt) {
    return {
        engineId: source.engineId,
        modelId: source.modelId,
        hardwareClass: source.hardwareClass,
        values: source.extract(content),
        source: source.url,
        fetchedAt,
    };
}
/**
 * resolveDefaults resolves the starting Config for one (engine, model,
 * hardware) over the registered presets and the engine's parameter surface.
 * Resolution order, per key: the explicit user value, the preset for the
 * detected hardware class, the built-in (wildcard) preset, then the
 * ParameterSpec defaultValue. The provenance list names the source that
 * supplied each value in the result, in key order.
 */
export function resolveDefaults(presets, specs, engineId, modelId, hw, explicit) {
    const detected = hardwareClass(hw);
    const forEngineModel = presets.filter((preset) => preset.engineId === engineId && preset.modelId === modelId);
    // Several presets can share a triple (the Hyper-Qwen tiers); the resolver
    // auto-picks the one marked isDefault, falling back to the first registered.
    const exactMatches = detected !== undefined
        ? forEngineModel.filter((preset) => preset.hardwareClass === detected)
        : [];
    const exact = exactMatches.find((preset) => preset.isDefault === true) ?? exactMatches[0];
    const builtin = forEngineModel.find((preset) => preset.hardwareClass === WILDCARD_HARDWARE_CLASS);
    // The floor is the spec defaultValue for every spec that carries one, so
    // the result is a complete starting config, not a partial one.
    const config = {};
    const sources = new Map();
    for (const spec of specs) {
        if (spec.defaultValue !== undefined) {
            config[spec.key] = spec.defaultValue;
            sources.set(spec.key, 'spec-default');
        }
    }
    // Overlay the built-in preset, then the exact-class preset, so the more
    // specific source wins per key.
    overlayPreset(builtin, config, sources);
    overlayPreset(exact, config, sources);
    if (explicit !== undefined) {
        for (const [key, value] of Object.entries(explicit)) {
            if (value === undefined)
                continue;
            config[key] = value;
            sources.set(key, 'user');
        }
    }
    const provenance = [...sources.entries()]
        .map(([key, source]) => ({ key, source }))
        .sort((a, b) => a.key.localeCompare(b.key));
    return { config, provenance };
}
/**
 * overlayPreset writes one preset's values over the running config and
 * records the preset's source per key, so the provenance names the preset
 * that last supplied each value.
 */
function overlayPreset(preset, config, sources) {
    if (preset === undefined)
        return;
    for (const [key, value] of Object.entries(preset.values)) {
        if (value === undefined)
            continue;
        config[key] = value;
        sources.set(key, preset.source);
    }
}
//# sourceMappingURL=defaults.js.map