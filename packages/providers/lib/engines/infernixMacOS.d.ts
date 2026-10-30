/**
 * The Infernix macOS build profile. macOS builds Infernix through the engine's
 * own cmake preset, the same route as Linux, so this profile reuses the shared
 * Linux build steps and build directory; the binary keeps its plain name (no
 * .exe on macOS).
 * @module dsh-plugin-local-infer/providers/engines/infernixMacOS
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const INFERNIX_MACOS: EngineOsProfile;
/**
 * infernixMacOSBinary returns the Infernix engine binary name on macOS: the
 * plain `infernix-serve` (no .exe on macOS). The name comes from the shared
 * Linux profile the macOS profile reuses, so the spelling has one home.
 */
export declare function infernixMacOSBinary(): string;
//# sourceMappingURL=infernixMacOS.d.ts.map