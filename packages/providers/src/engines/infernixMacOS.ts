/**
 * The Infernix macOS build profile. macOS builds Infernix through the engine's
 * own cmake preset, the same route as Linux, so this profile reuses the shared
 * Linux build steps and build directory; the binary keeps its plain name (no
 * .exe on macOS).
 * @module dsh-plugin-local-infer/providers/engines/infernixMacOS
 */

import type { EngineOsProfile } from './engineOs.ts'
import { INFERNIX_LINUX } from './infernixLinux.ts'

export const INFERNIX_MACOS: EngineOsProfile = INFERNIX_LINUX

/**
 * infernixMacOSBinary returns the Infernix engine binary name on macOS: the
 * plain `infernix-serve` (no .exe on macOS). The name comes from the shared
 * Linux profile the macOS profile reuses, so the spelling has one home.
 */
export function infernixMacOSBinary(): string {
  return INFERNIX_MACOS.binary ?? 'infernix-serve'
}
