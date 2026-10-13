import type { Config } from './config.ts';
import type { HardwareProfile } from './hardware.ts';
/**
 * HardwareClass is the coarse capability bucket a preset is sourced for, e.g.
 * "24g-sm86" for a 24 GiB Ampere card. A preset is only trusted for the exact
 * (engine, model, hardware class) it was sourced for.
 */
export type HardwareClass = string;
/**
 * Preset is a starting Config for one (engine, model, hardware class), tagged
 * with its source and fetch date so the UI can show provenance.
 */
export interface Preset {
    engineId: string;
    modelId: string;
    hardwareClass: HardwareClass;
    values: Config;
    source: string;
    fetchedAt?: string;
}
/**
 * DefaultProvenance reports which source supplied one value, so the UI can show
 * "sourced from NInfer docs (fetched 2026-10-13)".
 */
export interface DefaultProvenance {
    key: string;
    source: string;
}
/**
 * DefaultsResolver resolves a starting Config for (engineId, modelId,
 * hardware class). Resolution order: explicit user value, engine/model preset
 * for the detected hardware class, built-in preset, then the ParameterSpec
 * defaultValue. The resolver reports which source supplied each value.
 */
export interface DefaultsResolver {
    resolve(engineId: string, modelId: string, hw: HardwareProfile, explicit?: Config): {
        config: Config;
        provenance: DefaultProvenance[];
    };
}
//# sourceMappingURL=defaults.d.ts.map